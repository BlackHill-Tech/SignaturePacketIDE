import { GoogleGenAI, Type, Schema } from "@google/genai";
import { SignatureBlockExtraction } from "../types";

const SYSTEM_INSTRUCTION = `
You are a specialized legal AI assistant for transaction lawyers. 
Your task is to analyze an image of a document page and identify if it is a "Signature Page" (or "Execution Page").

### CRITICAL DEFINITIONS FOR EXTRACTION
1. **PARTY**: The legal entity or person entering into the contract (e.g., "ABC Holdings Limited", "XYZ Fund II, L.P."). 
   - Found in headings like "EXECUTED by ABC HOLDINGS LIMITED".
2. **SIGNATORY**: The human being physically signing the page.
   - Found under lines like "Name: Jane Smith" or "Signed by: ___".
   - A company CANNOT be a signatory.
3. **CAPACITY**: The role/authority of the signatory (e.g., "Director", "Authorised Signatory", "General Partner").
   - Found under "Title:".

### RULES
1. If this is a signature page, set isSignaturePage to true.
2. Extract ALL signature blocks found on the page.
3. For each block, strictly separate the **Party Name** (Entity), **Signatory Name** (Human), and **Capacity** (Title).
4. If a field is blank (e.g. "Name: _______"), leave the extracted value as empty string or "Unknown".
5. If it is NOT a signature page (e.g. text clauses only), set isSignaturePage to false.
`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    isSignaturePage: {
      type: Type.BOOLEAN,
      description: "True if the page contains a signature block for execution."
    },
    signatures: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          partyName: {
            type: Type.STRING,
            description: "The legal entity bound by the contract (The PARTY)."
          },
          signatoryName: {
             type: Type.STRING,
             description: "The human name of the person signing (The SIGNATORY)."
          },
          capacity: {
            type: Type.STRING,
            description: "The title or role of the person signing (The CAPACITY)."
          }
        }
      }
    }
  },
  required: ["isSignaturePage", "signatures"]
};

export const analyzePage = async (
  base64Image: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<SignatureBlockExtraction> => {
  // Remove data:image/jpeg;base64, prefix if present
  const cleanBase64 = base64Image.split(',')[1];

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          },
          {
            text: "Analyze this page. Is it a signature page? Extract the Party, Signatory, and Capacity according to the definitions."
          }
        ]
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as SignatureBlockExtraction;

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Fallback safe return
    return {
      isSignaturePage: false,
      signatures: []
    };
  }
};