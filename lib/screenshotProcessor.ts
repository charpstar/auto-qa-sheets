// lib/screenshotProcessor.ts

import puppeteer from "puppeteer";
import { put } from "@vercel/blob";
import { QAJob } from "./queue";

const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export interface ScreenshotResult {
  screenshots: string[];
  modelStats?: {
    meshCount: number;
    materialCount: number;
    vertices: number;
    triangles: number;
    doubleSidedCount: number;
    doubleSidedMaterials: string[];
    fileSize: number;
  };
  processingLogs: string[];
}

export class ScreenshotProcessor {
  // Download GLB file from your existing API
  private async downloadGLB(articleId: string): Promise<Buffer> {
    // Use full URL for server-side requests
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL
      ? process.env.NEXT_PUBLIC_BASE_URL
      : "http://localhost:3000";

    const url = `${baseUrl}/api/download-glb`;

    console.log(`📥 Downloading GLB from: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ articleId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to download GLB for article ${articleId}: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Convert GLB buffer to data URL for model-viewer
  private glbBufferToDataURL(buffer: Buffer): string {
    const base64 = buffer.toString("base64");
    return `data:model/gltf-binary;base64,${base64}`;
  }

  // Generate HTML for model-viewer with different camera angles
  private generateModelViewerHTML(
    glbDataURL: string,
    cameraAngle: string
  ): string {
    const cameraSettings = {
      front: 'camera-orbit="0deg 75deg 4m"',
      back: 'camera-orbit="180deg 75deg 4m"',
      left: 'camera-orbit="-90deg 75deg 4m"',
      right: 'camera-orbit="90deg 75deg 4m"',
      top: 'camera-orbit="0deg 0deg 4m"',
      isometric: 'camera-orbit="45deg 55deg 4m"',
    };

    return `
      <html>
        <head>
          <script type="module" src="https://demosetc.b-cdn.net/QATool/model-viewer.js"></script>
          <style>
            body { 
              margin: 0; 
              background: #f5f5f5;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
            }
            model-viewer {
              width: 800px;
              height: 600px;
              background-color: white;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            }
          </style>
        </head>
        <body>
          <model-viewer
            src="${glbDataURL}"
            ${
              cameraSettings[cameraAngle as keyof typeof cameraSettings] ||
              cameraSettings.front
            }
            auto-rotate="false"
            camera-controls="false"
            disable-zoom="true"
            exposure="1"
            shadow-intensity="1"
            alt="3D model screenshot"
            loading="eager"
          ></model-viewer>
        </body>
      </html>
    `;
  }

  // Extract model statistics from the loaded model
  private async extractModelStats(page: any, glbBuffer: Buffer): Promise<any> {
    try {
      console.log("📊 Starting model stats extraction...");

      // Wait for model to be fully loaded
      await page.waitForSelector("model-viewer", { timeout: 60000 });

      // Wait for model to load
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const modelViewer = document.querySelector("model-viewer") as any;
          if (modelViewer) {
            if (modelViewer.modelIsVisible) {
              console.log("Model is visible, extracting stats...");
              resolve(true);
            } else {
              modelViewer.addEventListener("load", () => {
                console.log("Model load event fired, extracting stats...");
                resolve(true);
              });
              setTimeout(() => {
                console.log("Model stats timeout, proceeding anyway...");
                resolve(true);
              }, 10000);
            }
          } else {
            console.log("No model-viewer found for stats");
            setTimeout(() => resolve(true), 3000);
          }
        });
      });

      // Extract model statistics using the same method as your client-side code
      const stats = await page.evaluate(() => {
        const modelViewer = document.querySelector("model-viewer") as any;
        console.log("Checking for getModelStats function...");

        if (modelViewer) {
          console.log("Model viewer found, checking for getModelStats...");

          if (typeof modelViewer.getModelStats === "function") {
            console.log("getModelStats function found, calling it...");
            try {
              const stats = modelViewer.getModelStats();
              console.log("Model stats extracted:", stats);
              return stats;
            } catch (error) {
              console.error("Error calling getModelStats:", error);
              return null;
            }
          } else {
            console.log("getModelStats function not available on model viewer");
            console.log(
              "Available methods:",
              Object.getOwnPropertyNames(modelViewer)
            );
            return null;
          }
        } else {
          console.log("No model viewer found");
          return null;
        }
      });

      if (stats) {
        // Add file size to stats
        const finalStats = {
          ...stats,
          fileSize: glbBuffer.length,
        };
        console.log("✅ Model stats extracted successfully:", finalStats);
        return finalStats;
      } else {
        console.log("⚠️ getModelStats function not available or returned null");
        return {
          meshCount: 0,
          materialCount: 0,
          vertices: 0,
          triangles: 0,
          doubleSidedCount: 0,
          doubleSidedMaterials: [],
          fileSize: glbBuffer.length,
        };
      }
    } catch (error) {
      console.error("❌ Error extracting model stats:", error);
      return {
        meshCount: 0,
        materialCount: 0,
        vertices: 0,
        triangles: 0,
        doubleSidedCount: 0,
        doubleSidedMaterials: [],
        fileSize: glbBuffer.length,
      };
    }
  }

  // Main processing function - ONE MODEL-VIEWER INSTANCE ONLY
  async processScreenshots(job: QAJob): Promise<ScreenshotResult> {
    const logs: string[] = [];
    const screenshots: string[] = [];
    let modelStats: any = null;

    try {
      console.log(
        `🚀 Starting screenshot processing for Article ID: ${job.articleId}`
      );
      logs.push(
        `Starting screenshot processing for Article ID: ${job.articleId}`
      );

      // Step 1: Download GLB file
      console.log("📥 Downloading GLB file...");
      logs.push("Downloading GLB file from Google Drive...");
      const glbBuffer = await this.downloadGLB(job.articleId);
      console.log(`✅ GLB downloaded: ${glbBuffer.length} bytes`);
      logs.push(`GLB file downloaded successfully: ${glbBuffer.length} bytes`);

      // Step 2: Convert to data URL
      console.log("🔄 Converting GLB to data URL...");
      const glbDataURL = this.glbBufferToDataURL(glbBuffer);
      console.log("✅ GLB converted to data URL");
      logs.push("GLB converted to data URL for model-viewer");

      // Step 3: Launch browser
      console.log("🚀 Launching browser...");
      logs.push("Launching headless browser...");
      const browser = await puppeteer.launch({
        executablePath: "/usr/bin/chromium-browser",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
        ],
        headless: true,
        timeout: 60000,
      });
      console.log("✅ Browser launched successfully");

      try {
        // Step 4: Create ONE page for both stats and screenshots
        console.log("📄 Creating browser page...");
        const page = await browser.newPage();
        try {
          page.on("console", (msg) => {
            const text = msg.text();
            if (!text.includes("GPU stall due to ReadPixels")) {
              console.log("PAGE LOG:", text);
            }
          });

          page.on("pageerror", (error) => {
            console.error("❌ PAGE ERROR:", error.message);
          });

          console.log("🖼️ Setting viewport...");
          await page.setViewport({ width: 800, height: 600 });

          console.log("📝 Generating HTML content...");
          const htmlContent = this.generateModelViewerHTML(glbDataURL, "front");

          console.log("🌐 Loading HTML content...");
          await page.setContent(htmlContent, { waitUntil: "networkidle0" });
          console.log("✅ HTML content loaded");

          // Wait for model to load once
          console.log("⏳ Waiting for model-viewer to load...");
          await page.waitForSelector("model-viewer", { timeout: 60000 });
          console.log("✅ Model-viewer element found");

          console.log("🎯 Waiting for model to become visible...");
          await page.evaluate(() => {
            return new Promise((resolve) => {
              const viewer = document.querySelector("model-viewer") as any;
              if (viewer?.modelIsVisible) {
                console.log("Model is already visible");
                resolve(true);
              } else {
                console.log("Waiting for model load event...");
                viewer?.addEventListener("load", () => {
                  console.log("Model load event fired");
                  resolve(true);
                });
                setTimeout(() => {
                  console.log("Model load timeout, proceeding anyway");
                  resolve(true);
                }, 15000);
              }
            });
          });
          console.log("✅ Model is loaded and ready");

          // Step 5: Extract model stats from the loaded model
          console.log("📊 Extracting model statistics...");
          logs.push("Extracting model statistics...");
          try {
            modelStats = await this.extractModelStats(page, glbBuffer);
            console.log("✅ Model stats extracted:", modelStats);
            logs.push("✅ Model statistics extracted successfully");
          } catch (statsError) {
            console.error("❌ Stats extraction failed:", statsError);
            logs.push(`⚠️ Failed to extract model stats: ${statsError}`);
            modelStats = {
              meshCount: 0,
              materialCount: 0,
              vertices: 0,
              triangles: 0,
              doubleSidedCount: 0,
              doubleSidedMaterials: [],
              fileSize: glbBuffer.length,
            };
          }

          // Step 6: Take screenshots using the same model-viewer
          console.log("📸 Starting screenshot capture...");
          const angles = ["front", "back", "left", "right", "isometric"];
          const cameraSettings: Record<string, string> = {
            front: "0deg 75deg 4m",
            back: "180deg 75deg 4m",
            left: "-90deg 75deg 4m",
            right: "90deg 75deg 4m",
            isometric: "45deg 55deg 4m",
          };

          for (const angle of angles) {
            console.log(`📷 Taking ${angle} screenshot...`);
            logs.push(`Taking screenshot from ${angle} angle...`);
            try {
              // Change camera angle on existing model-viewer
              await page.evaluate((orbitVal) => {
                const mv = document.querySelector("model-viewer");
                if (mv) {
                  mv.setAttribute("camera-orbit", orbitVal);
                  console.log(`Camera set to: ${orbitVal}`);
                } else {
                  console.error("Model-viewer not found!");
                }
              }, cameraSettings[angle]);

              // Wait for camera to move
              console.log(`⏳ Waiting for camera transition (${angle})...`);
              await new Promise((resolve) => setTimeout(resolve, 2000));

              // Take screenshot
              console.log(`📸 Capturing screenshot (${angle})...`);
              const screenshotBuffer = await page.screenshot({
                type: "png",
                fullPage: false,
              });

              console.log(`☁️ Uploading screenshot (${angle})...`);
              const filename = `qa-screenshot-${
                job.articleId
              }-${angle}-${generateId()}.png`;
              const { url } = await put(
                filename,
                Buffer.from(screenshotBuffer),
                {
                  access: "public",
                  contentType: "image/png",
                }
              );

              screenshots.push(url);
              console.log(`✅ ${angle} screenshot completed: ${url}`);
              logs.push(`✅ ${angle} screenshot completed: ${url}`);
            } catch (error) {
              const errorMsg = `Failed to capture ${angle} screenshot: ${
                error instanceof Error ? error.message : "Unknown error"
              }`;
              console.error(`❌ ${errorMsg}`);
              logs.push(`❌ ${errorMsg}`);
              // Continue with other angles even if one fails
            }
          }
        } catch (pageError) {
          console.error("❌ Page error:", pageError);
          throw pageError;
        } finally {
          console.log("🔒 Closing browser page...");
          await page.close();
        }
      } catch (browserError) {
        console.error("❌ Browser error:", browserError);
        throw browserError;
      } finally {
        console.log("🔒 Closing browser...");
        await browser.close();
        logs.push("Browser closed");
      }

      if (screenshots.length === 0) {
        const error = new Error("No screenshots were successfully captured");
        console.error("❌ Fatal error:", error.message);
        throw error;
      }

      console.log(
        `🎉 Screenshot processing completed: ${screenshots.length} images generated`
      );
      logs.push(
        `Screenshot processing completed: ${screenshots.length} images generated`
      );

      return {
        screenshots,
        modelStats,
        processingLogs: logs,
      };
    } catch (error) {
      const errorMsg = `Screenshot processing failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error("❌ FATAL ERROR:", errorMsg);
      console.error(
        "❌ Error stack:",
        error instanceof Error ? error.stack : "No stack trace"
      );
      logs.push(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}

// Export singleton instance
export const screenshotProcessor = new ScreenshotProcessor();
