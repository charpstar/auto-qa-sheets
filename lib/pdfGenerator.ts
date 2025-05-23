// lib/pdfGenerator.ts

import PDFDocument from "pdfkit";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { QAJob } from "./queue";

export interface PDFGenerationResult {
  pdfUrl: string;
  annotatedImages: string[];
  processingLogs: string[];
}

export class PDFGenerator {
  private tmpDir: string;

  constructor(jobId: string) {
    this.tmpDir = path.join("/tmp", `pdf-${jobId}`);
  }

  // Convert our AI analysis format to their annotation service format
  private formatAnalysisForAnnotator(job: QAJob) {
    if (!job.aiAnalysis) {
      throw new Error("No AI analysis available for PDF generation");
    }

    const formattedDiff = {
      differences: job.aiAnalysis.differences.map((diff) => ({
        renderIndex: diff.renderIndex,
        referenceIndex: diff.referenceIndex,
        issues: diff.issues,
        bbox: diff.bbox,
        severity: diff.severity,
      })),
      summary: job.aiAnalysis.summary,
      status: job.aiAnalysis.status,
    };

    return formattedDiff;
  }

  // Download images from URLs to local files for processing
  private async downloadImages(urls: string[]): Promise<string[]> {
    const allPaths: string[] = [];

    // Ensure temp directory exists
    if (fs.existsSync(this.tmpDir)) {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.tmpDir, { recursive: true });

    for (let idx = 0; idx < urls.length; idx++) {
      const url = urls[idx];
      let buf: Buffer;
      let ext = "png";

      if (url.startsWith("data:")) {
        const m = url.match(/^data:(.+?);base64,(.*)$/);
        if (!m) throw new Error(`Invalid data URL at index ${idx}`);
        buf = Buffer.from(m[2], "base64");
        ext = m[1].split("/")[1] || "png";
      } else {
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(
            `Fetch failed (${res.status}) for image ${idx}: ${url}`
          );
        const ab = await res.arrayBuffer();
        buf = Buffer.from(ab);
        const urlParts = url.split("?")[0].split(".");
        ext = urlParts.pop() || "png";
      }

      const filename = `img_${idx}.${ext}`;
      const filePath = path.join(this.tmpDir, filename);
      fs.writeFileSync(filePath, buf);
      allPaths.push(filePath);
    }

    return allPaths;
  }

  // Get annotated images from external service
  private async getAnnotatedImages(job: QAJob): Promise<string[]> {
    if (!job.screenshots || !job.aiAnalysis) {
      throw new Error("Missing screenshots or AI analysis for annotation");
    }

    // Combine screenshots and references for annotation
    const allUrls = [...job.screenshots, ...job.references];
    const allPaths = await this.downloadImages(allUrls);

    // Format the diff for the annotation service
    const formattedDiff = this.formatAnalysisForAnnotator(job);
    const diffPath = path.join(this.tmpDir, "diff.json");
    fs.writeFileSync(diffPath, JSON.stringify(formattedDiff, null, 2));

    // Prepare payload for annotation service
    const imagePayload = allPaths.map((p) => {
      const buffer = fs.readFileSync(p);
      const base64 = buffer.toString("base64");
      const filename = path.basename(p);
      return { filename, data: base64 };
    });

    console.log("📝 Sending images to annotation service...");

    try {
      const response = await fetch("http://45.76.82.207:8080/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: imagePayload,
          diff_json: fs.readFileSync(diffPath, "utf-8"),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Annotator server error: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();

      if (!Array.isArray(result.images) || result.images.length === 0) {
        throw new Error("No annotated images returned from annotator");
      }

      // Save annotated images locally
      const outDir = path.join(this.tmpDir, "annotations");
      fs.mkdirSync(outDir, { recursive: true });

      const annotatedPaths: string[] = [];

      for (const img of result.images) {
        if (!img.filename || !img.data) {
          console.warn("Skipping invalid image object:", img);
          continue;
        }

        const buffer = Buffer.from(img.data, "base64");
        const savePath = path.join(outDir, img.filename);
        fs.writeFileSync(savePath, buffer);
        annotatedPaths.push(savePath);
      }

      console.log(`✅ Generated ${annotatedPaths.length} annotated images`);
      return annotatedPaths;
    } catch (error) {
      console.error("❌ Annotation service failed:", error);
      // Fallback: return original screenshots without annotations
      console.log("⚠️ Using non-annotated images as fallback");
      return job.screenshots || [];
    }
  }

  // Generate PDF using adapted logic from the original system
  private async generatePDFDocument(
    annotatedImages: string[],
    job: QAJob
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // Get path to font (you may need to adjust this path)
        const ttf = path.join(process.cwd(), "fonts", "Roboto-Regular.ttf");
        let hasFont = fs.existsSync(ttf);

        // Prepare for logo
        const logoPath = path.join(this.tmpDir, "logo.png");
        let hasLogo = false;

        // Try to download the logo
        try {
          const logoRes = await fetch(
            "https://charpstar.se/Synsam/NewIntegrationtest/Charpstar-Logo.png"
          );
          if (logoRes.ok) {
            const logoBuffer = Buffer.from(await logoRes.arrayBuffer());
            fs.writeFileSync(logoPath, logoBuffer);
            hasLogo = true;
          }
        } catch (logoErr) {
          console.error("Failed to download logo:", logoErr);
        }

        // Create PDF document
        const doc = new PDFDocument({
          autoFirstPage: false,
          size: [595.28, 841.89], // A4 in points
          margins: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50,
          },
          info: {
            Title: "3D Model QA Report",
            Author: "3D Model QA Automator",
          },
        });

        // Register font if available
        if (hasFont) {
          doc.registerFont("MainFont", ttf);
          doc.font("MainFont");
        }

        // Collect PDF data
        const buffers: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => buffers.push(Buffer.from(chunk)));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", (err: Error) => reject(err));

        // Add first page
        doc.addPage();

        // --- PAGE 1: HEADER AND IMAGES ---
        if (hasLogo) {
          doc.image(logoPath, 40, 40, { width: 150 });
          doc.fontSize(14).text("3D Model QA Report", 50, 85);
        } else {
          doc.fontSize(16).text("3D Model QA Report", 50, 50);
        }

        // Add article info
        doc.fontSize(12).text(`Article ID: ${job.articleId}`, 50, 110);
        doc.text(`Product: ${job.productName}`, 50, 125);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 50, 140);

        // Horizontal rule
        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        // Add annotated images
        const contentWidth = 495;
        const imageWidth = contentWidth;
        const imageHeight = annotatedImages.length > 1 ? 280 : 380;
        let currentY = doc.y;

        for (let i = 0; i < annotatedImages.length; i++) {
          if (i > 0 && currentY + imageHeight + 40 > 750) {
            doc.addPage();
            currentY = 70;
          }

          doc.fontSize(12).text(`Analysis View ${i + 1}`, { align: "center" });
          doc.moveDown(0.3);
          currentY = doc.y;

          // Check if image file exists and is valid
          if (fs.existsSync(annotatedImages[i])) {
            try {
              doc.image(annotatedImages[i], 50, currentY, {
                width: imageWidth,
                height: imageHeight,
                fit: [imageWidth, imageHeight],
                align: "center",
              });
            } catch (imgError) {
              console.error(`Failed to add image ${i} to PDF:`, imgError);
              doc.text(`[Image ${i + 1} could not be loaded]`, 50, currentY);
            }
          } else {
            doc.text(`[Image ${i + 1} not found]`, 50, currentY);
          }

          currentY += imageHeight + 20;
          doc.y = currentY;
        }

        // --- PAGE 2: ANALYSIS RESULTS ---
        doc.addPage();

        // AI Analysis Results
        doc.fontSize(14).text("AI Analysis Results", { align: "left" });
        doc.moveDown(1);

        if (job.aiAnalysis) {
          // Approval Status
          doc.fontSize(12).text("Overall Status:", { continued: false });
          doc.moveDown(0.5);

          const statusColor =
            job.aiAnalysis.status === "Approved" ? "#34a853" : "#ea4335";
          doc.fillColor(statusColor);
          doc.fontSize(14).text(job.aiAnalysis.status, { continued: false });
          doc.fillColor("#000000");
          doc.moveDown(1);

          // Similarity Scores
          if (job.aiAnalysis.scores) {
            doc.fontSize(12).text("Similarity Scores:");
            doc.moveDown(0.5);
            doc.fontSize(10);
            doc.text(`• Silhouette: ${job.aiAnalysis.scores.silhouette}%`);
            doc.text(`• Proportion: ${job.aiAnalysis.scores.proportion}%`);
            doc.text(
              `• Color/Material: ${job.aiAnalysis.scores.colorMaterial}%`
            );
            doc.text(`• Overall: ${job.aiAnalysis.scores.overall}%`);
            doc.moveDown(1);
          }

          // Issues Found
          if (job.aiAnalysis.differences.length > 0) {
            doc
              .fontSize(12)
              .text(`Issues Found (${job.aiAnalysis.differences.length}):`);
            doc.moveDown(0.5);
            doc.fontSize(10);

            job.aiAnalysis.differences.forEach((diff, index) => {
              const severityColor =
                diff.severity === "high"
                  ? "#ea4335"
                  : diff.severity === "medium"
                  ? "#fbbc04"
                  : "#34a853";

              doc.fillColor(severityColor);
              doc.text(`${index + 1}. [${diff.severity.toUpperCase()}] `, {
                continued: true,
              });
              doc.fillColor("#000000");
              doc.text(diff.issues.join(" "), { continued: false });
              doc.moveDown(0.5);
            });
          } else {
            doc.fontSize(12).text("No issues found.");
          }

          doc.moveDown(1);

          // Summary
          doc.fontSize(12).text("Summary:");
          doc.moveDown(0.5);
          doc.fontSize(10).text(job.aiAnalysis.summary);
        }

        // Finalize PDF
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // Main PDF generation function
  async generatePDF(job: QAJob): Promise<PDFGenerationResult> {
    const logs: string[] = [];

    try {
      logs.push(`Starting PDF generation for Article ID: ${job.articleId}`);

      if (!job.screenshots || !job.aiAnalysis) {
        throw new Error(
          "Missing screenshots or AI analysis for PDF generation"
        );
      }

      // Step 1: Get annotated images
      logs.push("Getting annotated images from annotation service...");
      const annotatedImages = await this.getAnnotatedImages(job);
      logs.push(`Generated ${annotatedImages.length} annotated images`);

      // Step 2: Generate PDF
      logs.push("Generating PDF document...");
      const pdfBuffer = await this.generatePDFDocument(annotatedImages, job);
      logs.push(`PDF generated: ${pdfBuffer.length} bytes`);

      // Step 3: Upload to Vercel Blob
      logs.push("Uploading PDF to Vercel Blob...");
      const filename = `qa-report-${job.articleId}-${Date.now()}.pdf`;
      const { url } = await put(filename, pdfBuffer, {
        access: "public",
        contentType: "application/pdf",
      });
      logs.push(`PDF uploaded successfully: ${url}`);

      // Cleanup temp files
      if (fs.existsSync(this.tmpDir)) {
        fs.rmSync(this.tmpDir, { recursive: true, force: true });
        logs.push("Temporary files cleaned up");
      }

      return {
        pdfUrl: url,
        annotatedImages: annotatedImages.map(
          (path) => path.split("/").pop() || ""
        ),
        processingLogs: logs,
      };
    } catch (error) {
      const errorMsg = `PDF generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      logs.push(`❌ ${errorMsg}`);

      // Cleanup on error
      if (fs.existsSync(this.tmpDir)) {
        fs.rmSync(this.tmpDir, { recursive: true, force: true });
      }

      throw new Error(errorMsg);
    }
  }
}

// Export function for easy use
export async function generateQAReport(
  job: QAJob
): Promise<PDFGenerationResult> {
  const generator = new PDFGenerator(job.id);
  return await generator.generatePDF(job);
}
