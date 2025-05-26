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
    // Use the SAME directory structure as qa-jobs/route.ts
    this.tmpDir = path.join("/tmp", jobId);
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

  // Get annotated images - EXACTLY like qa-jobs/route.ts
  private async getAnnotatedImages(job: QAJob): Promise<string[]> {
    if (!job.screenshots || !job.aiAnalysis) {
      throw new Error("Missing screenshots or AI analysis for annotation");
    }

    try {
      // Take first 4 screenshots + all references (like working code)
      const renders = job.screenshots.slice(0, 4);
      const allUrls = [...renders, ...job.references];
      const allPaths = await this.downloadImages(allUrls);

      // Create diff JSON exactly like working code
      const diff = {
        differences: job.aiAnalysis.differences.map((d) => ({
          renderIndex: Math.min(d.renderIndex, 3), // Max render index is 3
          referenceIndex: d.referenceIndex,
          issues: d.issues,
          bbox: d.bbox,
          severity: d.severity,
        })),
        summary: job.aiAnalysis.summary,
        status: job.aiAnalysis.status,
      };

      const diffPath = path.join(this.tmpDir, "diff.json");
      fs.writeFileSync(diffPath, JSON.stringify(diff, null, 2));

      const outDir = path.join(this.tmpDir, "annotations");
      fs.mkdirSync(outDir, { recursive: true });

      // Call annotation service exactly like working code
      const imagePayload = allPaths.map((p) => {
        const buffer = fs.readFileSync(p);
        const base64 = buffer.toString("base64");
        const filename = path.basename(p);
        return { filename, data: base64 };
      });

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
        throw new Error("No annotated images returned from annotator.");
      }

      // Save annotated images exactly like working code
      fs.mkdirSync(outDir, { recursive: true });

      for (const img of result.images) {
        if (!img.filename || !img.data) {
          console.warn("Skipping invalid image object:", img);
          continue;
        }

        const buffer = Buffer.from(img.data, "base64");
        const savePath = path.join(outDir, img.filename);
        if (fs.existsSync(savePath)) {
          console.warn(`Overwriting existing image: ${img.filename}`);
        }

        try {
          fs.writeFileSync(savePath, buffer);
        } catch (err) {
          console.error(`Failed to save image ${img.filename}`, err);
        }
      }

      // Read from filesystem exactly like working code
      const annotated = fs
        .readdirSync(outDir)
        .filter((f) => f.endsWith(".png"))
        .map((f) => path.join(outDir, f));

      return annotated;
    } catch (error) {
      console.error("Annotation service failed:", error);
      // Fallback to original screenshots
      if (job.screenshots && job.screenshots.length > 0) {
        const fallbackPaths = await this.downloadImages(job.screenshots);
        return fallbackPaths;
      }
      return [];
    }
  }

  // Generate PDF exactly like qa-jobs/route.ts
  private async generatePDFDocument(
    annotatedImages: string[],
    job: QAJob
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const ttf = path.join(process.cwd(), "fonts", "Roboto-Regular.ttf");

        const logoPath = path.join(this.tmpDir, "logo.png");
        let hasLogo = false;

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

        const doc = new PDFDocument({
          autoFirstPage: false,
          size: [595.28, 841.89],
          margins: {
            top: 50,
            bottom: 50,
            left: 50,
            right: 50,
          },
          font: ttf,
          info: {
            Title: "3D Model QA Report",
            Author: "3D Model QA Automator",
          },
        });

        const buffers: Buffer[] = [];
        doc.on("data", (chunk) => buffers.push(Buffer.from(chunk)));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", (err) => reject(err));

        doc.registerFont("MainFont", ttf);
        doc.addPage();

        // Header
        if (hasLogo) {
          doc.image(logoPath, 40, 40, { width: 150 });
          doc.fontSize(14).text("3D Model QA Report", 50, 85);
        } else {
          doc.font("MainFont").fontSize(16).text("3D Model QA Report");
        }

        doc.fontSize(12).text(`Article ID: ${job.articleId}`, 50, 110);
        doc.text(`Product: ${job.productName}`, 50, 125);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 50, 140);

        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        // Images
        const contentWidth = 495;
        const imageWidth = contentWidth;
        const imageHeight = annotatedImages.length > 1 ? 280 : 380;
        const verticalGap = 10;
        let currentY = doc.y;

        for (let i = 0; i < annotatedImages.length; i++) {
          if (i > 0) {
            if (currentY + imageHeight + 40 > 750) {
              doc.addPage();
              currentY = 70;
            }
          }

          doc.fontSize(12).text(`Analysis View ${i + 1}`, { align: "center" });
          doc.moveDown(0.3);
          currentY = doc.y;

          const imagePath = annotatedImages[i];

          if (fs.existsSync(imagePath)) {
            try {
              const stats = fs.statSync(imagePath);
              if (stats.size > 0) {
                doc.image(imagePath, 50, currentY, {
                  width: imageWidth,
                  height: imageHeight,
                  fit: [imageWidth, imageHeight],
                  align: "center",
                });
              }
            } catch (imgError) {
              doc.text(`[Image ${i + 1} could not be loaded]`, 50, currentY);
            }
          } else {
            doc.text(`[Image ${i + 1} not found]`, 50, currentY);
          }

          currentY += imageHeight + verticalGap;
          doc.y = currentY;
        }

        // Technical Overview page
        doc.addPage();
        doc.fontSize(14).text("Technical Overview", { align: "left" });
        doc.moveDown(1.5);
        doc.fontSize(11);

        const addPropertyLine = (
          property: string,
          value: string | number,
          limit?: number | null,
          unit: string = ""
        ) => {
          const formatNumber = (num: number): string => {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          };

          const valueStr =
            (typeof value === "number" ? formatNumber(value) : value) + unit;
          const checkValue =
            typeof value === "number" ? value : parseFloat(String(value));

          const startY = doc.y;

          if (limit !== undefined) {
            const isCompliant = limit === null || checkValue <= limit;
            const circleColor = isCompliant ? "#34a853" : "#ea4335";
            doc
              .circle(65, startY + 6, 5)
              .fillColor(circleColor)
              .fill();
          } else {
            doc
              .circle(65, startY + 6, 5)
              .fillColor("#9aa0a6")
              .fill();
          }

          doc.fillColor("#000000");
          doc.text(property, 80, startY, { continued: false, width: 160 });
          doc.text(valueStr, 240, startY, {
            continued: false,
            width: 80,
            align: "right",
          });

          if (limit !== undefined) {
            doc
              .fillColor("#5f6368")
              .fontSize(10)
              .text(
                limit === null
                  ? ""
                  : `(limit: ${limit ? formatNumber(limit) : limit}${unit})`,
                330,
                startY,
                { width: contentWidth - 280, align: "right" }
              )
              .fillColor("#000000")
              .fontSize(11);
          }

          doc.moveDown(1.5);
        };

        const stats = job.modelStats;
        console.log("🔍 DEBUG - Model stats:", stats);
        console.log("🔍 DEBUG - Job keys:", Object.keys(job));

        if (stats) {
          addPropertyLine("Polycount", stats.vertices || 0, 150000);
          addPropertyLine("Triangles", stats.triangles || 0);
          addPropertyLine("Mesh Count", stats.meshCount || 0, 5);
          addPropertyLine("Material Count", stats.materialCount || 0, 5);
          addPropertyLine(
            "Double-sided Materials",
            stats.doubleSidedCount || 0,
            0
          );
          addPropertyLine(
            "File Size",
            parseFloat(((stats.fileSize || 0) / (1024 * 1024)).toFixed(2)),
            15,
            "MB"
          );
        } else {
          console.log("❌ No model stats available - using placeholder values");
          const properties = [
            "• Polycount: N/A",
            "• Material Count: N/A",
            "• File Size: N/A",
          ];
          properties.forEach((prop) => {
            doc.text(prop);
            doc.moveDown(1.5);
          });
        }

        const lineY = doc.y + 15;
        doc.moveTo(50, lineY).lineTo(545, lineY).stroke();
        doc.x = 50;
        doc.y = lineY + 20;

        // AI Analysis
        doc.fontSize(14).text("AI Analysis Results");
        doc.moveDown(0.5);

        if (job.aiAnalysis) {
          doc.fontSize(11).text(job.aiAnalysis.summary || "No issues found.");
          doc.moveDown(1);
          doc.fontSize(12).text("Status:");
          doc.moveDown(0.5);

          // Color code the status
          const statusColor =
            job.aiAnalysis.status === "Approved" ? "#34a853" : "#ea4335";
          doc.fillColor(statusColor);
          doc.fontSize(11).text(job.aiAnalysis.status);
          doc.fillColor("#000000"); // Reset to black
        } else {
          doc.fontSize(11).text("No AI analysis available.");
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  async generatePDF(job: QAJob): Promise<PDFGenerationResult> {
    const logs: string[] = [];

    try {
      logs.push(`Starting PDF generation for Article ID: ${job.articleId}`);

      if (!job.screenshots || !job.aiAnalysis) {
        throw new Error(
          "Missing screenshots or AI analysis for PDF generation"
        );
      }

      const annotatedImages = await this.getAnnotatedImages(job);
      logs.push(`Generated ${annotatedImages.length} images`);

      const pdfBuffer = await this.generatePDFDocument(annotatedImages, job);
      logs.push(`PDF generated: ${pdfBuffer.length} bytes`);

      const filename = `qa-report-${job.articleId}-${Date.now()}.pdf`;
      const { url } = await put(filename, pdfBuffer, {
        access: "public",
        contentType: "application/pdf",
      });
      logs.push(`PDF uploaded successfully: ${url}`);

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

      if (fs.existsSync(this.tmpDir)) {
        fs.rmSync(this.tmpDir, { recursive: true, force: true });
      }

      throw new Error(errorMsg);
    }
  }
}

export async function generateQAReport(
  job: QAJob
): Promise<PDFGenerationResult> {
  const generator = new PDFGenerator(job.id);
  return await generator.generatePDF(job);
}
