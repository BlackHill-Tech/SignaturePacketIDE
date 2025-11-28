# Signature Packet IDE

**Signature Packet IDE** is an AI-powered legal technology tool designed to automate the painful, manual process of preparing wet-ink signature pages for M&A, financing, and corporate transactions.

Instead of junior associates manually scrolling through hundreds of pages to find, extract, and sort signature pages, **Signature Packet IDE** uses computer vision and LLMs to identify, tag, and organize them in seconds.

## Features

- **AI-Powered Extraction**: Uses Google Gemini 2.5 Flash to visually identify signature pages and extract:
  - **Party Name** (Entity bound by the contract)
  - **Signatory Name** (Human signing the document)
  - **Capacity** (Title/Role)
- **Smart Grouping**: Organize output by:
  - **Agreement** (e.g., all pages for the SPA)
  - **Counterparty** (e.g., all pages for "Acme Corp" across all docs)
  - **Signatory** (e.g., all pages "Jane Smith" needs to sign)
- **Privacy-First**: Documents are processed in-memory. No file storage persistence.
- **Batch Processing**: Upload multiple transaction documents (PDF) at once.
- **Integrated Preview**: View original PDFs and extracted signature pages instantly.
- **Automatic Instructions**: Generates a clear signing table/instruction sheet for clients.
- **Print-Ready Export**: Downloads a ZIP file containing perfectly sorted PDF packets for each party or agreement.

## Tech Stack

- **Frontend**: React 19, Tailwind CSS, Lucide Icons
- **PDF Processing**: `pdf-lib`, `pdf.js`
- **AI/ML**: Google Gemini API (`gemini-2.5-flash`) via `@google/genai` SDK
- **Build**: TypeScript, Vite-compatible structure

## Setup & Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/signature-packet-ide.git
   cd signature-packet-ide
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Configuration**:
   Create a `.env` file in the root directory and add your Google Gemini API Key:
   ```env
   API_KEY=your_google_gemini_api_key_here
   ```

4. **Run the application**:
   ```bash
   npm start
   ```

## Usage Guide

1. **Upload**: Drag and drop your transaction documents (PDFs) into the sidebar.
2. **Review**: The AI will extract signature pages. Review the "Party", "Signatory", and "Capacity" fields in the card view.
3. **Adjust**:
   - Use the **Grouping Toggles** (Agreement / Party / Signatory) to change how pages are sorted.
   - Edit the **Copies** counter if a party needs to sign multiple originals.
4. **Instructions**: Click "Instructions" to view and copy a signing table to send to your client.
5. **Download**: Click "Download ZIP" to get the organized PDF packets.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)