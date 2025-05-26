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

  // Helper function to get status color based on limits
  private getStatusColor(
    value: number,
    limit: number,
    isInverse: boolean = false
  ): string {
    if (isInverse) {
      // For double-sided materials, red if above limit, green if at or below
      return value > limit ? "#ea4335" : "#34a853";
    }
    // For normal metrics, green if below limit, red if at or above
    return value <= limit ? "#34a853" : "#ea4335";
  }

  // Helper function to format file size
  private formatFileSize(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)}MB`;
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

    console.log("📝 Attempting to get annotated images...");

    try {
      // Combine screenshots and references for annotation - SAME AS REFERENCE
      const allUrls = [...job.screenshots, ...job.references];
      console.log("🔍 DEBUG - All URLs:", allUrls);

      const allPaths = await this.downloadImages(allUrls);
      console.log("🔍 DEBUG - Downloaded paths:", allPaths);

      // Format the diff for the annotation service
      const formattedDiff = this.formatAnalysisForAnnotator(job);
      console.log(
        "🔍 DEBUG - Formatted diff:",
        JSON.stringify(formattedDiff, null, 2)
      );

      const diffPath = path.join(this.tmpDir, "diff.json");
      fs.writeFileSync(diffPath, JSON.stringify(formattedDiff, null, 2));

      const outDir = path.join(this.tmpDir, "annotations");
      fs.mkdirSync(outDir, { recursive: true });

      // Prepare payload EXACTLY like reference code
      const imagePayload = allPaths.map((p) => {
        const buffer = fs.readFileSync(p);
        const base64 = buffer.toString("base64");
        const filename = path.basename(p);
        return { filename, data: base64 };
      });

      console.log("🔍 DEBUG - Image payload count:", imagePayload.length);
      console.log(
        "🔍 DEBUG - Image filenames:",
        imagePayload.map((img) => img.filename)
      );
      console.log(
        "🔍 DEBUG - Diff file content:",
        fs.readFileSync(diffPath, "utf-8")
      );

      // Make the request EXACTLY like reference code
      const response = await fetch("http://45.76.82.207:8080/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: imagePayload,
          diff_json: fs.readFileSync(diffPath, "utf-8"),
        }),
      });

      // Check for non-200 response - SAME AS REFERENCE
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Annotator server error: ${response.status} - ${errorText}`
        );
      }

      // Parse JSON result - SAME AS REFERENCE
      const result = await response.json();

      console.log("🔍 DEBUG - FULL RESPONSE:");
      console.log(JSON.stringify(result, null, 2));
      console.log("🔍 DEBUG - Response keys:", Object.keys(result));
      console.log("🔍 DEBUG - Has images property:", !!result.images);
      console.log("🔍 DEBUG - Images is array:", Array.isArray(result.images));
      console.log("🔍 DEBUG - Images length:", result.images?.length);

      if (!Array.isArray(result.images) || result.images.length === 0) {
        console.error("🔍 FULL RESULT OBJECT:", result);
        throw new Error("No annotated images returned from annotator.");
      }

      // Make sure the output directory exists - SAME AS REFERENCE
      fs.mkdirSync(outDir, { recursive: true });

      const annotatedPaths: string[] = [];

      // Save each annotated image to outDir - SAME AS REFERENCE
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
          annotatedPaths.push(savePath);
        } catch (err) {
          console.error(`Failed to save image ${img.filename}`, err);
        }
      }

      console.log(`✅ Generated ${annotatedPaths.length} annotated images`);
      return annotatedPaths;
    } catch (error) {
      console.error("❌ Annotation service failed:", error);
      // Fallback: download original screenshots to local files
      console.log("⚠️ Using original screenshots as fallback");

      if (job.screenshots && job.screenshots.length > 0) {
        console.log(
          `📸 Downloading ${job.screenshots.length} original screenshots as fallback`
        );

        try {
          // Download the original screenshots to local files
          const fallbackPaths = await this.downloadImages(job.screenshots);
          console.log(`✅ Downloaded ${fallbackPaths.length} fallback images`);
          return fallbackPaths;
        } catch (downloadError) {
          console.error(
            "❌ Failed to download fallback images:",
            downloadError
          );
          console.warn("⚠️ No images available for PDF");
          return [];
        }
      } else {
        console.warn("⚠️ No screenshots available for fallback");
        return [];
      }
    }
  }

  // Generate PDF using adapted logic from the original system
  private async generatePDFDocument(
    annotatedImages: string[],
    job: QAJob
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        // Get path to Roboto font
        const ttf = path.join(process.cwd(), "fonts", "Roboto-Regular.ttf");

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

        // Create PDF document with standard A4 size and minimal margins
        const doc = new PDFDocument({
          autoFirstPage: false,
          size: [595.28, 841.89], // A4 in points
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

        // Create our own data collection system
        const buffers: Buffer[] = [];
        doc.on("data", (chunk) => buffers.push(Buffer.from(chunk)));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", (err) => reject(err));

        // Register our font
        doc.registerFont("MainFont", ttf);

        // Add first page
        doc.addPage();

        // --- PAGE 1: HEADER AND IMAGES ---

        // Header - use logo if available, otherwise text
        if (hasLogo) {
          doc.image(logoPath, 40, 40, { width: 150 });
          doc
            .fontSize(14)
            .text("3D Model QA Report", 50, 85, { continued: false });
        } else {
          // Fallback to original behavior
          doc
            .font("MainFont")
            .fontSize(16)
            .text("3D Model QA Report", { continued: false });
        }

        // Add article info
        doc.fontSize(12).text(`Article ID: ${job.articleId}`, 50, 110);
        doc.text(`Product: ${job.productName}`, 50, 125);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 50, 140);

        // Horizontal rule
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        // Calculate available content width and height
        const contentWidth = 495; // 595.28 - 50 - 50 (page width minus margins)

        // Create a combined layout for all image pairs to ensure they're on the same page
        // If we have multiple images, make them smaller to fit
        const imageWidth = contentWidth;
        const imageHeight = annotatedImages.length > 1 ? 280 : 380; // Smaller if multiple images
        const verticalGap = 10;

        let currentY = doc.y;

        console.log(`📄 Adding ${annotatedImages.length} images to PDF...`);

        if (annotatedImages.length === 0) {
          // No images available, show a message
          doc
            .fontSize(12)
            .text("No analysis images available", { align: "center" });
          doc.moveDown(2);
        } else {
          // Process each image
          for (let i = 0; i < annotatedImages.length; i++) {
            // Add a new page for each new image after the first, except for the first page
            if (i > 0) {
              // Only add a page break when needed
              if (currentY + imageHeight + 40 > 750) {
                doc.addPage();
                currentY = 70; // Reset Y position on new page
              }
            }

            // Add image caption
            doc
              .fontSize(12)
              .text(`Analysis View ${i + 1}`, { align: "center" });
            doc.moveDown(0.3);
            currentY = doc.y;

            const imagePath = annotatedImages[i];
            console.log(`📄 Processing image ${i + 1}: ${imagePath}`);

            // Place image
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
                  console.log(`✅ Successfully added image ${i + 1} to PDF`);
                } else {
                  throw new Error("Image file is empty");
                }
              } catch (imgError) {
                console.error(
                  `❌ Failed to add image ${i + 1} to PDF:`,
                  imgError
                );
                doc.text(`[Image ${i + 1} could not be loaded]`, 50, currentY);
              }
            } else {
              console.error(`❌ Image file not found: ${imagePath}`);
              doc.text(`[Image ${i + 1} not found]`, 50, currentY);
            }

            // Move position for next image
            currentY += imageHeight + verticalGap;
            doc.y = currentY;
          }
        }

        // --- MODEL PROPERTIES AND QA SUMMARY ALWAYS ON A NEW PAGE ---

        // Always start a new page for the analysis section
        doc.addPage();

        // 3D Model Properties section
        doc.fontSize(14).text("Technical Overview", { align: "left" });
        doc.moveDown(1.5);

        // Create a two-column layout
        const originalY = doc.y; // Store the starting Y position

        // Model properties with icons for compliance - LEFT COLUMN
        doc.fontSize(11);

        // Function to add a property line with check/x mark
        const addPropertyLine = (
          property: string,
          value: string | number,
          limit?: number | null,
          unit: string = ""
        ) => {
          // Format number with commas for thousands
          const formatNumber = (num: number): string => {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          };

          const valueStr =
            (typeof value === "number" ? formatNumber(value) : value) + unit;
          const checkValue =
            typeof value === "number" ? value : parseFloat(String(value));

          // Start horizontal positioning
          const startY = doc.y;

          // Draw colored circle icon based on compliance
          if (limit !== undefined) {
            const isCompliant = limit === null || checkValue <= limit;
            const circleColor = isCompliant ? "#34a853" : "#ea4335"; // Green or Red

            doc
              .circle(65, startY + 6, 5)
              .fillColor(circleColor)
              .fill();
          } else {
            // Gray circle for properties with no limit
            doc
              .circle(65, startY + 6, 5)
              .fillColor("#9aa0a6")
              .fill();
          }

          // Reset fill color for text
          doc.fillColor("#000000");

          // Property name (left aligned)
          doc.text(property, 80, startY, { continued: false, width: 160 });

          // Value (center-right aligned)
          doc.text(valueStr, 240, startY, {
            continued: false,
            width: 80,
            align: "right",
          });

          // Limit text (right aligned)
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

        // Add model properties with their limits
        const stats = job.modelStats;
        if (stats) {
          addPropertyLine("Polycount", stats.vertices, 150000);
          addPropertyLine("Triangles", stats.triangles);
          addPropertyLine("Mesh Count", stats.meshCount, 5);
          addPropertyLine("Material Count", stats.materialCount, 5);
          addPropertyLine("Double-sided Materials", stats.doubleSidedCount, 0);
          addPropertyLine(
            "File Size",
            parseFloat((stats.fileSize / (1024 * 1024)).toFixed(2)),
            15,
            "MB"
          );
        } else {
          // Use placeholder values if no stats provided
          const properties = [
            "• Polycount: 150,000",
            "• Material Count: 5",
            "• File Size: 5.2MB",
          ];

          properties.forEach((prop) => {
            doc.text(prop);
            doc.moveDown(1.5);
          });
        }

        // Add a horizontal line across the full page width
        const lineY = doc.y + 15;
        doc.moveTo(50, lineY).lineTo(545, lineY).stroke();

        // Reset position to continue after the horizontal line
        doc.x = 50;
        doc.y = lineY + 20;

        // AI Analysis Results section
        doc.fontSize(14).text("AI Analysis Results");
        doc.moveDown(0.5);

        if (job.aiAnalysis) {
          // Summary text
          doc.fontSize(11).text(job.aiAnalysis.summary || "No issues found.");
          doc.moveDown(1);

          doc.fontSize(12).text("Status:");
          doc.moveDown(0.5);

          doc.fontSize(11);
          doc.text(job.aiAnalysis.status);
        } else {
          doc.fontSize(11).text("No AI analysis available.");
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

      if (annotatedImages.length === 0) {
        logs.push("⚠️ No images available, but continuing with PDF generation");
      } else {
        logs.push(`Generated ${annotatedImages.length} annotated images`);
      }

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
