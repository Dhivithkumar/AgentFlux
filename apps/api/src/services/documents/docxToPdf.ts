import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Converts a DOCX file to a PDF file using Microsoft Word COM object via PowerShell.
 * Preserves the exact layout of the source Word document.
 * This must run on a Windows machine with Microsoft Word installed.
 * 
 * @param inputPath Absolute path to the input DOCX file
 * @param outputPath Absolute path where the output PDF should be saved
 */
export function convertDocxToPdfWindows(inputPath: string, outputPath: string): void {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  
  // Normalize paths for PowerShell
  const inPath = path.resolve(inputPath).replace(/\//g, '\\');
  const outPath = path.resolve(outputPath).replace(/\//g, '\\');
  
  const psScript = `
    $ErrorActionPreference = "Stop";
    $word = New-Object -ComObject Word.Application;
    $word.Visible = $false;
    $word.DisplayAlerts = "wdAlertsNone";
    
    try {
        $doc = $word.Documents.Open("${inPath}", $false, $true);
        $doc.SaveAs([ref] "${outPath}", [ref] 17); # 17 is wdFormatPDF
        $doc.Close([ref] 0); # wdDoNotSaveChanges
    } catch {
        Write-Error $_.Exception.Message;
        exit 1;
    } finally {
        $word.Quit();
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null;
    }
  `;
  
  // Save the script to a temporary ps1 file to avoid escaping issues
  const tempScriptPath = path.join(path.dirname(outputPath), `convert_${Date.now()}.ps1`);
  fs.writeFileSync(tempScriptPath, psScript, 'utf8');
  
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${tempScriptPath}"`, { stdio: 'pipe' });
  } catch (error: any) {
    throw new Error(`Word PDF conversion failed: ${error.message} - ${error.stdout?.toString()} - ${error.stderr?.toString()}`);
  } finally {
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }
  }
  
  if (!fs.existsSync(outPath)) {
    throw new Error(`PDF was not created at ${outPath}`);
  }
}
