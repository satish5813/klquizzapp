import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a bundled worker URL (works inside Electron too).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Extract all text from a PDF File (used to fill the syllabus box). */
export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    out += tc.items.map((it: any) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
