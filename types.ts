export interface ProcessedDocument {
  id: string;
  name: string;
  file: File;
  pageCount: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress?: number; // 0 to 100
  extractedPages: ExtractedSignaturePage[];
}

export interface ExtractedSignaturePage {
  id: string;
  documentId: string;
  documentName: string;
  pageIndex: number; // 0-based index
  pageNumber: number; // 1-based human readable
  partyName: string;
  signatoryName: string; // The human signing
  capacity: string;
  copies: number;
  thumbnailUrl: string; // Data URL of the page image
  originalWidth: number;
  originalHeight: number;
}

export type GroupingMode = 'agreement' | 'counterparty' | 'signatory';

export interface SignatureBlockExtraction {
  isSignaturePage: boolean;
  signatures: Array<{
    partyName: string;
    signatoryName: string;
    capacity: string;
  }>;
}

// Ensure PDF.js types are recognized globally as we load via CDN
declare global {
  const pdfjsLib: any;
}