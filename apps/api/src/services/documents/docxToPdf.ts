import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import PDFDocument from 'pdfkit';
import mammoth from 'mammoth';

/**
 * Pure Node.js fallback converter using mammoth and pdfkit.
 * Guarantees PDF conversion without relying on platform-specific software
 * like Microsoft Word or LibreOffice.
 */
export async function convertWithPureNodeFallback(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const textResult = await mammoth.extractRawText({ path: inputPath });
  const rawText = textResult.value || 'Document';

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const stream = fs.createWriteStream(outputPath);

      doc.pipe(stream);

      // Simple clean formatting
      const lines = rawText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          doc.moveDown(0.5);
          continue;
        }

        // Check if header-like line
        if (
          trimmed.toUpperCase().includes('QUOTATION') ||
          trimmed.toUpperCase().includes('INVOICE') ||
          trimmed.toUpperCase().startsWith('TAX INVOICE')
        ) {
          doc.fontSize(18).text(trimmed, { align: 'center' });
          doc.moveDown(0.5);
        } else if (
          trimmed.includes('Total') ||
          trimmed.includes('Subtotal') ||
          trimmed.includes('Grand Total')
        ) {
          doc.fontSize(12).text(trimmed, { stroke: false });
        } else {
          doc.fontSize(10).text(trimmed);
        }
      }

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Converts DOCX to PDF.
 * Tries the high-fidelity platform converter first (Microsoft Word COM on Windows, soffice on Linux).
 * If the platform-specific software is unavailable or fails, gracefully falls back
 * to pure Node.js conversion (mammoth + pdfkit) so document generation never breaks.
 */
export async function convertDocxToPdf(inputPath: string, outputPath: string): Promise<void> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const inPath = path.resolve(inputPath);
  const outPath = path.resolve(outputPath);
  const outDir = path.dirname(outPath);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let converted = false;

  // 1. Try Windows Word COM
  if (os.platform() === 'win32') {
    const psScript = `
      $ErrorActionPreference = "Stop";
      $word = New-Object -ComObject Word.Application;
      $word.Visible = $false;
      $word.DisplayAlerts = "wdAlertsNone";
      try {
          $doc = $word.Documents.Open("${inPath.replace(/\\/g, '\\\\')}", $false, $true);
          $doc.SaveAs([ref] "${outPath.replace(/\\/g, '\\\\')}", [ref] 17);
          $doc.Close([ref] 0);
      } catch {
          Write-Error $_.Exception.Message;
          exit 1;
      } finally {
          $word.Quit();
          [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null;
      }
    `;
    const tempScriptPath = path.join(outDir, `convert_${Date.now()}.ps1`);
    try {
      fs.writeFileSync(tempScriptPath, psScript, 'utf8');
      execSync(`powershell -ExecutionPolicy Bypass -File "${tempScriptPath}"`, {
        stdio: 'pipe',
        timeout: 30000
      });
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        converted = true;
      }
    } catch (error: any) {
      console.warn(
        `[docxToPdf] Word COM conversion failed: ${error.message}. Falling back to pure Node engine.`
      );
    } finally {
      if (fs.existsSync(tempScriptPath)) {
        try {
          fs.unlinkSync(tempScriptPath);
        } catch {}
      }
    }
  } else {
    // 2. Try Linux / Mac LibreOffice
    try {
      execSync(`soffice --headless --convert-to pdf "${inPath}" --outdir "${outDir}"`, {
        stdio: 'pipe',
        timeout: 30000
      });
      const defaultOutPath = path.join(outDir, path.basename(inPath, '.docx') + '.pdf');
      if (defaultOutPath !== outPath && fs.existsSync(defaultOutPath)) {
        fs.renameSync(defaultOutPath, outPath);
      }
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        converted = true;
      }
    } catch (error: any) {
      console.warn(
        `[docxToPdf] soffice conversion failed: ${error.message}. Falling back to pure Node engine.`
      );
    }
  }

  // 3. Pure Node.js fallback (guaranteed cross-platform, no external binaries required)
  if (!converted) {
    try {
      await convertWithPureNodeFallback(inPath, outPath);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        converted = true;
      }
    } catch (fallbackError: any) {
      throw new Error(`Pure Node PDF conversion failed: ${fallbackError.message}`);
    }
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error(`PDF was not created or is empty at ${outPath}`);
  }
}
