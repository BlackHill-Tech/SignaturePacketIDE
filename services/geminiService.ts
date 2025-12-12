import { GoogleGenAI, Type, Schema } from "@google/genai";
import { SignatureMetadataExtraction } from "../types";

const SYSTEM_INSTRUCTION = `
You are a specialized legal AI assistant for transaction lawyers.
Your task is to analyze an image of a document signature page and extract the signature block details.

This page has already been identified as a signature/execution page. Your job is ONLY to extract the metadata from it.

### CRITICAL DEFINITIONS FOR EXTRACTION
1. **PARTY**: The legal entity or person entering into the contract (e.g., "ABC Holdings Limited", "XYZ Fund II, L.P.").
   - Found in headings like "EXECUTED by ABC HOLDINGS LIMITED".
   - Look for entity names appearing before or above signature lines.
2. **SIGNATORY**: The human being physically signing the page.
   - Found under lines like "Name: Jane Smith" or "Signed by: ___".
   - A company CANNOT be a signatory.
   - If the name field is blank or has a signature line, return empty string.
3. **CAPACITY**: The role/authority of the signatory (e.g., "Director", "Authorised Signatory", "General Partner").
   - Found under "Title:" or next to the signatory name.

### RULES
1. Extract ALL signature blocks found on the page.
2. For each block, strictly separate the **Party Name** (Entity), **Signatory Name** (Human), and **Capacity** (Title).
3. If a field is blank (e.g. "Name: _______"), leave the extracted value as empty string.
4. If you cannot identify any signature blocks, return an empty signatures array.
`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
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
  required: ["signatures"]
};

/**
 * Extracts signature metadata (party, signatory, capacity) from a confirmed signature page.
 * This function assumes the page has already been identified as a signature page via procedural detection.
 */
export const extractSignatureMetadata = async (
  base64Image: string,
  modelName: string = 'gemini-2.5-flash'
): Promise<SignatureMetadataExtraction> => {
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
            text: "Extract the Party, Signatory, and Capacity from each signature block on this signature page."
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

    return JSON.parse(text) as SignatureMetadataExtraction;

  } catch (error) {
    console.error("Gemini Metadata Extraction Error:", error);
    // Fallback safe return
    return {
      signatures: []
    };
  }
};