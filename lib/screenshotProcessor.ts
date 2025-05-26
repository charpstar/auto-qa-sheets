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
    const cameraSettings: Record<string, string> = {
      front: 'camera-orbit="0deg 75deg 4m"',
      back: 'camera-orbit="180deg 75deg 4m"',
      left: 'camera-orbit="-90deg 75deg 4m"',
      right: 'camera-orbit="90deg 75deg 4m"',
      top: 'camera-orbit="0deg 0deg 4m"',
      isometric: 'camera-orbit="45deg 55deg 4m"',
    };

    const cameraOrbit = cameraSettings[cameraAngle] || cameraSettings.front;

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>3D Model Viewer</title>
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
            ${cameraOrbit}
            auto-rotate="false"
            camera-controls="false"
            disable-zoom="true"
            exposure="1"
            shadow-intensity="1"
            alt="3D model screenshot"
            loading="eager"
          ></model-viewer>
          
          <script type="module" src="https://demosetc.b-cdn.net/QATool/model-viewer.js"></script>
          
          <script>
            // Wait for script to load and custom elements to be defined
            let scriptLoaded = false;
            let modelReady = false;
            
            // Check if model-viewer custom element is defined
            function waitForModelViewer() {
              return new Promise((resolve) => {
                if (customElements.get('model-viewer')) {
                  console.log('✅ model-viewer custom element is defined');
                  scriptLoaded = true;
                  resolve(true);
                } else {
                  console.log('⏳ Waiting for model-viewer custom element...');
                  customElements.whenDefined('model-viewer').then(() => {
                    console.log('✅ model-viewer custom element defined');
                    scriptLoaded = true;
                    resolve(true);
                  });
                  
                  // Fallback timeout
                  setTimeout(() => {
                    console.log('⚠️ Timeout waiting for model-viewer definition');
                    scriptLoaded = true;
                    resolve(true);
                  }, 10000);
                }
              });
            }
            
            // Initialize when everything is ready
            async function init() {
              await waitForModelViewer();
              
              const modelViewer = document.querySelector('model-viewer');
              if (modelViewer) {
                console.log('🎯 Model viewer element found');
                
                // Add event listeners
                modelViewer.addEventListener('load', () => {
                  console.log('✅ Model loaded successfully');
                  modelReady = true;
                });
                
                modelViewer.addEventListener('error', (event) => {
                  console.error('❌ Model loading error:', event.detail);
                });
                
                modelViewer.addEventListener('model-visibility', (event) => {
                  console.log('👁️ Model visibility changed:', event.detail.visible);
                });
                
                // Check if model is already loaded
                if (modelViewer.modelIsVisible) {
                  console.log('✅ Model is already visible');
                  modelReady = true;
                }
              } else {
                console.error('❌ Model viewer element not found');
              }
            }
            
            // Start initialization
            init();
            
            // Global function to check readiness
            window.checkReadiness = function() {
              return {
                scriptLoaded: scriptLoaded,
                modelReady: modelReady,
                element: !!document.querySelector('model-viewer')
              };
            };
          </script>
        </body>
      </html>
    `;
  }

  // Extract model statistics from the loaded model
  private async extractModelStats(
    page: puppeteer.Page,
    glbBuffer: Buffer
  ): Promise<any> {
    try {
      console.log("📊 Starting model stats extraction...");

      // Wait for model-viewer element to be present
      await page.waitForSelector("model-viewer", { timeout: 60000 });

      // Wait for the custom script to load and model to be ready
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const checkReady = () => {
            if (typeof (window as any).checkReadiness === "function") {
              const status = (window as any).checkReadiness();
              console.log("Readiness status:", status);

              if (status.scriptLoaded && status.element) {
                console.log("✅ Script loaded and element ready");
                resolve(true);
              } else {
                console.log("⏳ Still waiting for readiness...");
                setTimeout(checkReady, 1000);
              }
            } else {
              console.log("⏳ checkReadiness function not available yet...");
              setTimeout(checkReady, 1000);
            }
          };

          // Start checking
          checkReady();

          // Fallback timeout
          setTimeout(() => {
            console.log("⚠️ Readiness check timeout, proceeding anyway");
            resolve(true);
          }, 20000);
        });
      });

      // Wait for model to actually load
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const modelViewer = document.querySelector("model-viewer") as any;
          if (modelViewer) {
            console.log(
              "🎯 Model viewer found, checking if model is loaded..."
            );

            // Check if model is already visible
            if (modelViewer.modelIsVisible) {
              console.log("✅ Model is already visible");
              resolve(true);
            } else {
              console.log("⏳ Waiting for model to load...");

              const loadHandler = () => {
                console.log("✅ Model load event fired");
                modelViewer.removeEventListener("load", loadHandler);
                resolve(true);
              };

              const errorHandler = (event: any) => {
                console.error("❌ Model loading error:", event.detail);
                modelViewer.removeEventListener("error", errorHandler);
                resolve(true); // Continue anyway
              };

              modelViewer.addEventListener("load", loadHandler);
              modelViewer.addEventListener("error", errorHandler);

              // Fallback timeout for model loading
              setTimeout(() => {
                console.log("⚠️ Model loading timeout, proceeding anyway");
                modelViewer.removeEventListener("load", loadHandler);
                modelViewer.removeEventListener("error", errorHandler);
                resolve(true);
              }, 15000);
            }
          } else {
            console.error("❌ No model-viewer element found");
            setTimeout(() => resolve(true), 3000);
          }
        });
      });

      // Give additional time for model to fully render
      await page.waitForTimeout(3000);

      // Extract model statistics with comprehensive error handling
      const stats = await page.evaluate(() => {
        const modelViewer = document.querySelector("model-viewer") as any;
        console.log("🔍 Attempting to extract model stats...");

        if (!modelViewer) {
          console.error("❌ No model viewer found");
          return null;
        }

        console.log("✅ Model viewer found");
        console.log(
          "📋 Available properties:",
          Object.getOwnPropertyNames(modelViewer)
        );
        console.log(
          "📋 Available methods:",
          Object.getOwnPropertyNames(Object.getPrototypeOf(modelViewer))
        );

        // Check multiple possible method names
        const possibleMethods = [
          "getModelStats",
          "getStats",
          "modelStats",
          "stats",
        ];
        let statsMethod = null;

        for (const method of possibleMethods) {
          if (typeof modelViewer[method] === "function") {
            console.log(`✅ Found stats method: ${method}`);
            statsMethod = method;
            break;
          }
        }

        if (statsMethod) {
          try {
            console.log(`🎯 Calling ${statsMethod}()...`);
            const stats = modelViewer[statsMethod]();
            console.log("✅ Model stats extracted:", stats);
            return stats;
          } catch (error) {
            console.error(`❌ Error calling ${statsMethod}:`, error);
            return null;
          }
        } else {
          console.log("⚠️ No stats method found");

          // Try to access any stats-related properties directly
          const possibleProps = ["stats", "modelStats", "_stats", "__stats"];
          for (const prop of possibleProps) {
            if (modelViewer[prop]) {
              console.log(`✅ Found stats property: ${prop}`);
              console.log("📊 Stats from property:", modelViewer[prop]);
              return modelViewer[prop];
            }
          }

          console.log("❌ No stats method or property available");
          return null;
        }
      });

      if (stats && typeof stats === "object") {
        const finalStats = {
          ...stats,
          fileSize: glbBuffer.length,
        };
        console.log("✅ Model stats extracted successfully:", finalStats);
        return finalStats;
      } else {
        console.log("⚠️ No valid stats returned, using defaults");
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

  private async takeScreenshot(
    browser: puppeteer.Browser,
    glbDataURL: string,
    angle: string,
    articleId: string
  ): Promise<string> {
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 800, height: 600 });

      // Enable console logging from the page for debugging
      page.on("console", (msg) => {
        console.log(`PAGE LOG [${angle}]:`, msg.text());
      });

      page.on("pageerror", (error) => {
        console.error(`PAGE ERROR [${angle}]:`, error.message);
      });

      const htmlContent = this.generateModelViewerHTML(glbDataURL, angle);
      await page.setContent(htmlContent, { waitUntil: "networkidle0" });

      console.log(`Waiting for model-viewer to load for ${angle}...`);

      // Wait for model-viewer to load
      await page.waitForSelector("model-viewer", { timeout: 60000 });

      // Wait for script and model to be ready using the readiness check
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const checkReady = () => {
            if (typeof (window as any).checkReadiness === "function") {
              const status = (window as any).checkReadiness();
              if (status.scriptLoaded && status.element) {
                resolve(true);
              } else {
                setTimeout(checkReady, 500);
              }
            } else {
              setTimeout(checkReady, 500);
            }
          };

          checkReady();

          // Fallback timeout
          setTimeout(() => resolve(true), 15000);
        });
      });

      // Wait for model to actually load and render
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const modelViewer = document.querySelector("model-viewer") as any;
          if (modelViewer) {
            if (modelViewer.modelIsVisible) {
              console.log("Model is already visible for screenshot");
              resolve(true);
            } else {
              const loadHandler = () => {
                console.log("Model loaded for screenshot");
                modelViewer.removeEventListener("load", loadHandler);
                resolve(true);
              };

              const errorHandler = (event: any) => {
                console.error("Model error for screenshot:", event.detail);
                modelViewer.removeEventListener("error", errorHandler);
                resolve(true);
              };

              modelViewer.addEventListener("load", loadHandler);
              modelViewer.addEventListener("error", errorHandler);

              setTimeout(() => {
                console.log("Screenshot model loading timeout");
                modelViewer.removeEventListener("load", loadHandler);
                modelViewer.removeEventListener("error", errorHandler);
                resolve(true);
              }, 10000);
            }
          } else {
            console.error("No model viewer for screenshot");
            setTimeout(() => resolve(true), 2000);
          }
        });
      });

      // Additional wait for rendering
      await page.waitForTimeout(2000);

      console.log(`Taking screenshot for ${angle}...`);

      // Take screenshot
      const screenshotBuffer = await page.screenshot({
        type: "png",
        fullPage: false,
        omitBackground: false,
      });

      if (!screenshotBuffer || screenshotBuffer.length === 0) {
        throw new Error(
          `Screenshot capture failed for angle: ${angle} - Empty buffer`
        );
      }

      console.log(
        `Screenshot captured for ${angle}, size: ${screenshotBuffer.length} bytes`
      );

      // Upload to Vercel Blob
      const filename = `qa-screenshot-${articleId}-${angle}-${generateId()}.png`;
      const { url } = await put(filename, screenshotBuffer as Buffer, {
        access: "public",
        contentType: "image/png",
      });

      console.log(`✅ Screenshot uploaded: ${angle} - ${url}`);
      return url;
    } catch (error) {
      console.error(`❌ Error taking screenshot for ${angle}:`, error);
      throw error;
    } finally {
      await page.close();
    }
  }

  // Main processing function
  async processScreenshots(job: QAJob): Promise<ScreenshotResult> {
    const logs: string[] = [];
    const screenshots: string[] = [];
    let modelStats: any = null;

    try {
      logs.push(
        `Starting screenshot processing for Article ID: ${job.articleId}`
      );

      // Step 1: Download GLB file
      logs.push("Downloading GLB file from Google Drive...");
      const glbBuffer = await this.downloadGLB(job.articleId);
      logs.push(`GLB file downloaded successfully: ${glbBuffer.length} bytes`);

      // Validate GLB buffer
      if (glbBuffer.length === 0) {
        throw new Error("Downloaded GLB file is empty");
      }

      // Step 2: Convert to data URL
      const glbDataURL = this.glbBufferToDataURL(glbBuffer);
      logs.push("GLB converted to data URL for model-viewer");

      // Step 3: Launch browser with better configuration
      logs.push("Launching headless browser...");
      const browser = await puppeteer.launch({
        executablePath:
          process.env.NODE_ENV === "production"
            ? "/usr/bin/chromium-browser"
            : undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--disable-features=VizDisplayCompositor",
        ],
        headless: true,
        timeout: 60000,
      });

      try {
        // Step 4: Extract model stats first (using a dedicated page)
        logs.push("Extracting model statistics...");
        const statsPage = await browser.newPage();
        try {
          await statsPage.setViewport({ width: 800, height: 600 });
          const htmlContent = this.generateModelViewerHTML(glbDataURL, "front");
          await statsPage.setContent(htmlContent, {
            waitUntil: "networkidle0",
          });

          modelStats = await this.extractModelStats(statsPage, glbBuffer);

          if (modelStats && modelStats.meshCount > 0) {
            logs.push("✅ Model statistics extracted successfully");
          } else {
            logs.push(
              "⚠️ Model statistics extraction failed or returned empty data"
            );
          }
        } catch (statsError) {
          const errorMsg =
            statsError instanceof Error ? statsError.message : "Unknown error";
          logs.push(`⚠️ Failed to extract model stats: ${errorMsg}`);
          modelStats = {
            meshCount: 0,
            materialCount: 0,
            vertices: 0,
            triangles: 0,
            doubleSidedCount: 0,
            doubleSidedMaterials: [],
            fileSize: glbBuffer.length,
          };
        } finally {
          await statsPage.close();
        }

        // Step 5: Take screenshots from different angles
        const angles = ["front", "back", "left", "right", "isometric"];

        for (const angle of angles) {
          logs.push(`Taking screenshot from ${angle} angle...`);
          try {
            const screenshotUrl = await this.takeScreenshot(
              browser,
              glbDataURL,
              angle,
              job.articleId
            );
            screenshots.push(screenshotUrl);
            logs.push(`✅ ${angle} screenshot completed: ${screenshotUrl}`);
          } catch (error) {
            const errorMsg = `Failed to capture ${angle} screenshot: ${
              error instanceof Error ? error.message : "Unknown error"
            }`;
            logs.push(`❌ ${errorMsg}`);
            console.error(errorMsg);
            // Continue with other angles even if one fails
          }
        }
      } finally {
        await browser.close();
        logs.push("Browser closed");
      }

      if (screenshots.length === 0) {
        throw new Error(
          "No screenshots were successfully captured. Check GLB file validity and model-viewer compatibility."
        );
      }

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
      logs.push(`❌ ${errorMsg}`);
      console.error("Full error details:", error);
      throw new Error(errorMsg);
    }
  }
}

// Export singleton instance
export const screenshotProcessor = new ScreenshotProcessor();
