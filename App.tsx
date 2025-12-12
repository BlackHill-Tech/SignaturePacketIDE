import React, { useState, useMemo } from 'react';
import { UploadCloud, File as FileIcon, Loader2, Download, Layers, Users, X, CheckCircle2, FileText, Eye, UserPen } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { ExtractedSignaturePage, GroupingMode, ProcessedDocument } from './types';
import { getPageCount, renderPageToImage, generateGroupedPdfs, findSignaturePages, extractSinglePagePdf } from './services/pdfService';
import { extractSignatureMetadata } from './services/geminiService';
import SignatureCard from './components/SignatureCard';
import PdfPreviewModal from './components/PdfPreviewModal';
import InstructionsModal from './components/InstructionsModal';

// Concurrency Constants for AI - Keeping AI limit per doc to avoid rate limits, but unlimited docs
const CONCURRENT_AI_REQUESTS_PER_DOC = 5;

const App: React.FC = () => {
  const [documents, setDocuments] = useState<ProcessedDocument[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string>('');
  
  // Grouping & Filtering State
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('agreement');
  
  // Drag & Drop State
  const [isDragging, setIsDragging] = useState(false);

  // Preview State
  const [previewState, setPreviewState] = useState<{
    isOpen: boolean;
    url: string | null;
    title: string;
  }>({ isOpen: false, url: null, title: '' });

  // Instructions Modal State
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);

  // --- Handlers ---

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Check for API Key
    if (!process.env.API_KEY) {
        alert("API_KEY is missing from environment. Please provide a valid key.");
        return;
    }

    const newDocs: ProcessedDocument[] = Array.from(files).map(f => {
        // Validation: Strict PDF Check
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
        
        return {
            id: uuidv4(),
            name: f.name,
            file: f,
            pageCount: 0,
            status: isPdf ? 'pending' : 'error',
            extractedPages: []
        };
    });

    setDocuments(prev => [...prev, ...newDocs]);
    
    // Process all valid pending docs immediately
    // const validDocsToProcess = newDocs.filter(d => d.status === 'pending');
    // processAllDocuments(validDocsToProcess);
  };

  const handleProcessPending = () => {
    const pendingDocs = documents.filter(d => d.status === 'pending');
    processAllDocuments(pendingDocs);
  };

  /**
   * Process all documents in parallel ("All in one go")
   */
  const processAllDocuments = async (docsToProcess: ProcessedDocument[]) => {
    if (docsToProcess.length === 0) return;
    
    setIsProcessing(true);
    setCurrentStatus(`Processing ${docsToProcess.length} documents...`);

    // Fire off all requests simultaneously
    await Promise.all(docsToProcess.map(doc => processSingleDocument(doc)));

    setIsProcessing(false);
    setCurrentStatus('');
  };

  const processSingleDocument = async (doc: ProcessedDocument) => {
      // Update status to processing
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'processing', progress: 0 } : d));

      try {
        const pageCount = await getPageCount(doc.file);

        // 1. Procedural Signature Page Detection (weighted pattern matching)
        // This replaces the old heuristic + AI confirmation approach
        const signaturePages = await findSignaturePages(doc.file, (curr, total) => {
           // Update progress for scanning phase (0-50%)
           const progress = Math.round((curr / total) * 50);
           setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, progress } : d));
        });

        // 2. AI Metadata Extraction on Confirmed Signature Pages
        // Now we only call Gemini to extract party/signatory/capacity (not to confirm if it's a sig page)
        const extractedPages: ExtractedSignaturePage[] = [];

        if (signaturePages.length === 0) {
           console.log(`No signature pages found in ${doc.name} via procedural detection.`);
           setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, progress: 100 } : d));
        } else {
            // Process confirmed signature pages in chunks for AI metadata extraction
            let processedCount = 0;
            const totalPages = signaturePages.length;

            for (let i = 0; i < signaturePages.length; i += CONCURRENT_AI_REQUESTS_PER_DOC) {
                const chunk = signaturePages.slice(i, i + CONCURRENT_AI_REQUESTS_PER_DOC);

                const chunkPromises = chunk.map(async (sigPage) => {
                    try {
                        const { dataUrl, width, height } = await renderPageToImage(doc.file, sigPage.pageIndex);
                        // Extract metadata only (page is already confirmed as signature page)
                        const metadata = await extractSignatureMetadata(dataUrl);

                        // If AI couldn't extract any signatures, create a default entry
                        // (the page was procedurally detected as a sig page, so include it)
                        if (metadata.signatures.length === 0) {
                            return [{
                                id: uuidv4(),
                                documentId: doc.id,
                                documentName: doc.name,
                                pageIndex: sigPage.pageIndex,
                                pageNumber: sigPage.pageIndex + 1,
                                partyName: "Unknown Party",
                                signatoryName: "",
                                capacity: "Signatory",
                                copies: 1,
                                thumbnailUrl: dataUrl,
                                originalWidth: width,
                                originalHeight: height
                            }];
                        }

                        return metadata.signatures.map(sig => ({
                            id: uuidv4(),
                            documentId: doc.id,
                            documentName: doc.name,
                            pageIndex: sigPage.pageIndex,
                            pageNumber: sigPage.pageIndex + 1,
                            partyName: sig.partyName || "Unknown Party",
                            signatoryName: sig.signatoryName || "",
                            capacity: sig.capacity || "Signatory",
                            copies: 1,
                            thumbnailUrl: dataUrl,
                            originalWidth: width,
                            originalHeight: height
                        }));
                    } catch (err) {
                        console.error(`Error extracting metadata from page ${sigPage.pageIndex} of ${doc.name}`, err);
                        return [];
                    }
                });

                const chunkResults = await Promise.all(chunkPromises);

                // Update progress for AI phase (50-100%)
                processedCount += chunk.length;
                const aiProgress = 50 + Math.round((processedCount / totalPages) * 50);
                setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, progress: aiProgress } : d));

                // Flatten and add to results
                chunkResults.flat().forEach(p => {
                    if(p) extractedPages.push(p);
                });
            }
        }

        setDocuments(prev => prev.map(d => d.id === doc.id ? {
          ...d,
          status: 'completed',
          progress: 100,
          pageCount,
          extractedPages
        } : d));

      } catch (error) {
        console.error(`Error processing doc ${doc.name}`, error);
        setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error' } : d));
      }
  };

  const handleUpdateCopies = (pageId: string, newCount: number) => {
    setDocuments(prev => prev.map(doc => ({
      ...doc,
      extractedPages: doc.extractedPages.map(p => p.id === pageId ? { ...p, copies: newCount } : p)
    })));
  };

  const handleUpdateParty = (pageId: string, newParty: string) => {
     setDocuments(prev => prev.map(doc => ({
      ...doc,
      extractedPages: doc.extractedPages.map(p => p.id === pageId ? { ...p, partyName: newParty } : p)
    })));
  };

  const handleUpdateSignatory = (pageId: string, newSignatory: string) => {
    setDocuments(prev => prev.map(doc => ({
     ...doc,
     extractedPages: doc.extractedPages.map(p => p.id === pageId ? { ...p, signatoryName: newSignatory } : p)
   })));
 };

  const handleUpdateCapacity = (pageId: string, newCapacity: string) => {
     setDocuments(prev => prev.map(doc => ({
      ...doc,
      extractedPages: doc.extractedPages.map(p => p.id === pageId ? { ...p, capacity: newCapacity } : p)
    })));
  };

  const handleDeletePage = (pageId: string) => {
      setDocuments(prev => prev.map(doc => ({
        ...doc,
        extractedPages: doc.extractedPages.filter(p => p.id !== pageId)
      })));
  };

  const removeDocument = (docId: string) => {
    setDocuments(prev => prev.filter(d => d.id !== docId));
  };

  // --- Preview Logic ---

  const openPreview = (url: string, title: string) => {
    setPreviewState({ isOpen: true, url, title });
  };

  const closePreview = () => {
    if (previewState.url) {
      URL.revokeObjectURL(previewState.url);
    }
    setPreviewState({ isOpen: false, url: null, title: '' });
  };

  const handlePreviewDocument = async (doc: ProcessedDocument) => {
    if (doc.status === 'error') return; // Don't preview errored files
    const url = URL.createObjectURL(doc.file);
    openPreview(url, doc.name);
  };

  const handlePreviewSignaturePage = async (page: ExtractedSignaturePage) => {
    // Find the original document file
    const parentDoc = documents.find(d => d.id === page.documentId);
    if (!parentDoc) return;

    try {
      const pdfBytes = await extractSinglePagePdf(parentDoc.file, page.pageIndex);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      openPreview(url, `${page.documentName} - Page ${page.pageNumber}`);
    } catch (e) {
      console.error("Preview error", e);
      alert("Could not generate preview.");
    }
  };

  // --- Derived State for View ---

  const allPages = useMemo(() => {
    return documents.flatMap(d => d.extractedPages);
  }, [documents]);

  const uniqueParties = useMemo(() => {
    const parties = new Set(allPages.map(p => p.partyName));
    return ['All', ...(Array.from(parties) as string[]).sort()];
  }, [allPages]);

  const displayedPages = useMemo(() => {
    let pages = allPages;
    
    // Sort logic
    if (groupingMode === 'agreement') {
      return pages.sort((a, b) => {
        if (a.documentName !== b.documentName) return a.documentName.localeCompare(b.documentName);
        return a.pageIndex - b.pageIndex;
      });
    } else if (groupingMode === 'counterparty') {
      return pages.sort((a, b) => {
        if (a.partyName !== b.partyName) return a.partyName.localeCompare(b.partyName);
        return a.documentName.localeCompare(b.documentName);
      });
    } else {
       // By Signatory
       return pages.sort((a, b) => {
         const sigA = a.signatoryName || 'ZZZ';
         const sigB = b.signatoryName || 'ZZZ';
         if (sigA !== sigB) return sigA.localeCompare(sigB);
         return a.partyName.localeCompare(b.partyName);
       });
    }
  }, [allPages, groupingMode]);

  const navigationGroups = useMemo(() => {
    const groups = new Set<string>();
    displayedPages.forEach(p => {
      if (groupingMode === 'agreement') groups.add(p.documentName);
      else if (groupingMode === 'counterparty') groups.add(p.partyName);
      else groups.add(p.signatoryName || 'Unknown Signatory');
    });
    return Array.from(groups);
  }, [displayedPages, groupingMode]);

  const scrollToGroup = (groupName: string) => {
    const id = `group-${groupName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // --- Export Logic ---

  const handleDownloadPack = async () => {
    if (displayedPages.length === 0) return;
    setIsProcessing(true);
    setCurrentStatus('Generating ZIP Pack...');
    
    try {
      const pdfs = await generateGroupedPdfs(documents, displayedPages, groupingMode);
      
      const zip = new JSZip();
      
      // Add each PDF to the zip file
      for (const [filename, data] of Object.entries(pdfs)) {
        zip.file(filename, data);
      }

      // Generate the ZIP blob
      const zipContent = await zip.generateAsync({ type: 'blob' });
      
      // Trigger download
      const url = window.URL.createObjectURL(zipContent);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SignaturePack_${groupingMode}_${new Date().toISOString().slice(0,10)}.zip`;
      link.click();
      
    } catch (e) {
      console.error(e);
      alert("Failed to generate ZIP pack");
    } finally {
      setIsProcessing(false);
      setCurrentStatus('');
    }
  };

  // --- Render ---

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      
      {/* PDF Preview Modal */}
      <PdfPreviewModal 
        isOpen={previewState.isOpen}
        title={previewState.title}
        onClose={closePreview}
        pdfUrl={previewState.url}
      />

      {/* Instructions Modal */}
      <InstructionsModal
        isOpen={isInstructionsOpen}
        onClose={() => setIsInstructionsOpen(false)}
        pages={displayedPages}
      />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">S</div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight leading-none">Signature Packet IDE</h1>
            <p className="text-xs text-slate-500 font-medium">Automated Signature Page Extraction</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
             {/* Stats */}
             <div className="hidden md:flex gap-4 text-xs font-medium text-slate-500 mr-4">
               <span>{documents.length} Docs</span>
               <span>{allPages.length} Sig Pages Found</span>
             </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar: Documents */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-slate-100">
             <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Documents</h2>
             <div 
                className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFileUpload(e.dataTransfer.files);
                }}
             >
                <input 
                  type="file" 
                  multiple 
                  accept=".pdf"
                  className="hidden" 
                  id="fileInput"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                <label htmlFor="fileInput" className="cursor-pointer flex flex-col items-center">
                   <UploadCloud className="text-blue-500 mb-2" size={24} />
                   <span className="text-sm font-medium text-slate-700">Upload Agreements</span>
                   <span className="text-xs text-slate-400 mt-1">PDF only</span>
                </label>
             </div>

             <button
                onClick={handleProcessPending}
                disabled={isProcessing || !documents.some(d => d.status === 'pending')}
                className="w-full mt-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
             >
                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                Extract
             </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
             {documents.map(doc => (
               <div key={doc.id} className={`group relative flex items-center gap-3 p-3 rounded-md border transition-all ${doc.status === 'error' ? 'bg-red-50 border-red-100' : 'hover:bg-slate-50 border-transparent hover:border-slate-100'}`}>
                  <div className={`p-2 rounded text-slate-500 ${doc.status === 'error' ? 'bg-red-100 text-red-500' : 'bg-slate-100'}`}>
                     <FileIcon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                     <p className={`text-sm font-medium truncate ${doc.status === 'error' ? 'text-red-700' : 'text-slate-700'}`} title={doc.name}>{doc.name}</p>
                     <div className="text-xs text-slate-500 flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          {doc.status === 'processing' && <><Loader2 size={10} className="animate-spin" /> Processing...</>}
                          {doc.status === 'completed' && <><CheckCircle2 size={10} className="text-green-500" /> {doc.extractedPages.length} sig pages</>}
                          {doc.status === 'error' && <span className="text-red-500">PDF only</span>}
                          {doc.status === 'pending' && 'Queued'}
                        </div>
                        {doc.status === 'processing' && doc.progress !== undefined && (
                          <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                            <div 
                              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" 
                              style={{ width: `${doc.progress}%` }}
                            ></div>
                          </div>
                        )}
                     </div>
                  </div>
                  
                  {/* Document Actions */}
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {doc.status !== 'error' && (
                        <button 
                        onClick={() => handlePreviewDocument(doc)} 
                        className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-blue-500 transition-all mr-1"
                        title="Preview Document"
                        >
                        <Eye size={14} />
                        </button>
                    )}
                    <button 
                      onClick={() => removeDocument(doc.id)} 
                      className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-all"
                      title="Remove Document"
                    >
                      <X size={14} />
                    </button>
                  </div>

               </div>
             ))}

             {documents.length === 0 && (
               <div className="text-center p-8 text-slate-400 text-sm">
                 No documents uploaded yet.
               </div>
             )}
          </div>
        </div>

        {/* Main Content: Review Grid */}
        <div className="flex-1 flex flex-col bg-slate-50/50">
          
          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-sm z-10">
            <div className="flex items-center gap-4">
              <div className="flex bg-slate-100 p-1 rounded-md">
                 <button 
                   onClick={() => setGroupingMode('agreement')}
                   className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-2 transition-all ${groupingMode === 'agreement' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <Layers size={14} /> Agreement
                 </button>
                 <button 
                   onClick={() => setGroupingMode('counterparty')}
                   className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-2 transition-all ${groupingMode === 'counterparty' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <Users size={14} /> Party
                 </button>
                 <button 
                   onClick={() => setGroupingMode('signatory')}
                   className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-2 transition-all ${groupingMode === 'signatory' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <UserPen size={14} /> Signatory
                 </button>
              </div>
            </div>
          </div>

          {/* Content Area with Nav */}
          <div className="flex-1 flex overflow-hidden">
            {/* Grid Area */}
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
            
             {displayedPages.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <Layers size={32} className="text-slate-300" />
                  </div>
                  <p className="text-lg font-medium text-slate-500">No signature pages found yet</p>
                  <p className="text-sm max-w-md text-center mt-2">Upload agreements (PDF) to begin extraction.</p>
               </div>
             ) : (
                <div className="space-y-8 pb-20">
                   {/* Render grouping headers based on current mode */}
                   {displayedPages.reduce((acc: React.ReactNode[], page, idx, arr) => {
                      const prev = arr[idx-1];
                      let shouldInsertHeader = false;
                      let headerText = '';
                      let HeaderIcon = Layers;

                      if (groupingMode === 'agreement') {
                          shouldInsertHeader = !prev || prev.documentName !== page.documentName;
                          headerText = page.documentName;
                          HeaderIcon = FileText;
                      } else if (groupingMode === 'counterparty') {
                          shouldInsertHeader = !prev || prev.partyName !== page.partyName;
                          headerText = page.partyName;
                          HeaderIcon = Users;
                      } else {
                          // Signatory
                          const currentSig = page.signatoryName || 'Unknown Signatory';
                          const prevSig = prev?.signatoryName || 'Unknown Signatory';
                          shouldInsertHeader = !prev || prevSig !== currentSig;
                          headerText = currentSig;
                          HeaderIcon = UserPen;
                      }

                      if (shouldInsertHeader) {
                        const headerId = `group-${headerText.replace(/[^a-zA-Z0-9]/g, '_')}`;
                        acc.push(
                          <div id={headerId} key={`head-${headerText}-${idx}`} className="flex items-center gap-2 pb-2 border-b border-slate-200 mt-4 first:mt-0 scroll-mt-4">
                            <HeaderIcon size={16} className="text-slate-400" />
                            <h3 className="text-sm font-bold text-slate-700">{headerText}</h3>
                          </div>
                        );
                      }
                      
                      acc.push(
                        <SignatureCard 
                            key={page.id} 
                            page={page} 
                            existingParties={uniqueParties.filter(p => p !== 'All')}
                            onUpdateCopies={handleUpdateCopies}
                            onUpdateParty={handleUpdateParty}
                            onUpdateSignatory={handleUpdateSignatory}
                            onUpdateCapacity={handleUpdateCapacity}
                            onDelete={handleDeletePage}
                            onPreview={handlePreviewSignaturePage}
                        />
                      );
                      return acc;
                   }, [])}
                </div>
             )}

            </div>

            {/* Right Nav Rail */}
            {displayedPages.length > 0 && (
              <div className="w-64 bg-white border-l border-slate-200 overflow-y-auto p-4 hidden xl:block flex-shrink-0">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Jump to {groupingMode === 'counterparty' ? 'Party' : groupingMode === 'signatory' ? 'Signatory' : 'Agreement'}
                </h3>
                <ul className="space-y-1">
                  {navigationGroups.map(g => (
                    <li key={g}>
                      <button 
                        onClick={() => scrollToGroup(g)}
                        className="text-sm text-slate-600 hover:text-blue-600 hover:bg-slate-50 w-full text-left px-2 py-1.5 rounded transition-colors truncate"
                        title={g}
                      >
                        {g}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Floating Action Bar */}
          {displayedPages.length > 0 && (
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-1 py-1 rounded-full shadow-xl flex items-center gap-1 z-20">
               <button 
                 onClick={() => setIsInstructionsOpen(true)}
                 disabled={isProcessing}
                 className="px-5 py-2.5 rounded-full hover:bg-slate-800 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50"
               >
                 <FileText size={16} /> Instructions
               </button>
               <div className="w-px h-5 bg-slate-700"></div>
               <button 
                 onClick={handleDownloadPack}
                 disabled={isProcessing}
                 className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 transition-colors font-medium text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20 disabled:opacity-50"
               >
                 {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                 Download
               </button>
            </div>
          )}

          {/* Status Toast */}
          {currentStatus && (
            <div className="absolute top-4 right-6 bg-white border border-slate-200 shadow-lg rounded-md px-4 py-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 z-50 max-w-sm">
               <Loader2 size={18} className="animate-spin text-blue-500" />
               <span className="text-sm font-medium text-slate-700">{currentStatus}</span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default App;