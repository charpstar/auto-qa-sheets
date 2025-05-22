import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium-min";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export async function GET() {
  const isProd = process.env.NODE_ENV === "production";

  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: isProd ? await chromium.executablePath() : undefined,
      args: isProd ? chromium.args : [],
      defaultViewport: isProd ? chromium.defaultViewport : undefined,
    });

    const page = await browser.newPage();

    const htmlContent = `
      <html>
        <head>
          <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
          <style>body { margin: 0; }</style>
        </head>
        <body>
          <model-viewer
            style="width: 800px; height: 600px;"
            src="https://modelviewer.dev/shared-assets/models/Astronaut.glb"
            auto-rotate
            camera-controls
            disable-zoom
            exposure="1"
            alt="A 3D model"
          ></model-viewer>
        </body>
      </html>
    `;

    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    // Wait for model to render
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const screenshotBuffer = await page.screenshot();
    await browser.close();

    if (!screenshotBuffer) {
      throw new Error("Screenshot capture failed");
    }

    // Upload to Vercel Blob Storage
    const { url } = await put(
      `model-screenshot-${generateId()}.png`,
      screenshotBuffer as Buffer,
      {
        access: "public",
        contentType: "image/png",
      }
    );

    console.log("✅ Uploaded to Blob Storage:", url);

    return NextResponse.json({
      success: true,
      message: "Screenshot captured and uploaded to Vercel Blob.",
      screenshots: [url],
    });
  } catch (error: any) {
    console.error("❌ Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
