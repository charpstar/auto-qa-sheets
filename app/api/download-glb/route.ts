import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Initialize Google Drive API
function initializeDriveAPI() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      project_id: process.env.GOOGLE_PROJECT_ID,
    },
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

// Search for GLB file by Article ID
async function findGLBFile(
  drive: any,
  articleId: string
): Promise<string | null> {
  try {
    console.log(`🔍 Searching for GLB file: ${articleId}.glb`);

    const response = await drive.files.list({
      q: `name contains '${articleId}' and '${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed=false`,

      fields: "files(id, name)",
    });
    console.log("Files in folder:", response.data.files);
    const files = response.data.files;

    if (!files || files.length === 0) {
      console.log(`❌ No GLB file found for Article ID: ${articleId}`);
      return null;
    }

    const file = files[0];
    console.log(
      `✅ Found GLB file: ${file.name} (ID: ${file.id}, Size: ${file.size} bytes)`
    );

    return file.id;
  } catch (error) {
    console.error("Error searching for GLB file:", error);
    throw error;
  }
}

// Download GLB file from Google Drive
async function downloadGLBFile(drive: any, fileId: string): Promise<Buffer> {
  try {
    console.log(`📥 Downloading GLB file with ID: ${fileId}`);

    const response = await drive.files.get(
      {
        fileId: fileId,
        alt: "media",
      },
      {
        responseType: "stream",
      }
    );

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      response.data.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      response.data.on("end", () => {
        const buffer = Buffer.concat(chunks);
        console.log(`✅ Downloaded GLB file: ${buffer.length} bytes`);
        resolve(buffer);
      });

      response.data.on("error", (error: any) => {
        console.error("Error downloading GLB file:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error downloading GLB file:", error);
    throw error;
  }
}

// API Route Handler
export async function POST(request: NextRequest) {
  try {
    const { articleId } = await request.json();

    if (!articleId) {
      return NextResponse.json(
        { error: "Article ID is required" },
        { status: 400 }
      );
    }

    console.log(
      `🚀 Starting GLB download process for Article ID: ${articleId}`
    );

    // Validate environment variables
    const requiredEnvVars = [
      "GOOGLE_DRIVE_FOLDER_ID",
      "GOOGLE_CLIENT_EMAIL",
      "GOOGLE_PRIVATE_KEY",
      "GOOGLE_PROJECT_ID",
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing environment variable: ${envVar}`);
      }
    }

    // Initialize Google Drive API
    const drive = initializeDriveAPI();

    // Search for the GLB file
    const fileId = await findGLBFile(drive, articleId);

    if (!fileId) {
      return NextResponse.json(
        {
          error: `GLB file not found for Article ID: ${articleId}`,
          suggestion: `Make sure a file named '${articleId}.glb' exists in your Google Drive folder`,
        },
        { status: 404 }
      );
    }

    // Download the GLB file
    const glbBuffer = await downloadGLBFile(drive, fileId);

    const response = new NextResponse(glbBuffer);
    response.headers.set("Content-Type", "model/gltf-binary");
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="${articleId}.glb"`
    );
    return response;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("❌ GLB download error:", errorMessage);

    return NextResponse.json(
      {
        error: errorMessage,
        articleId:
          (await request.json().catch(() => ({})))?.articleId || "unknown",
      },
      { status: 500 }
    );
  }
}

// GET endpoint for testing
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const articleId = url.searchParams.get("articleId");

    if (!articleId) {
      return NextResponse.json({
        message: "GLB Download API - Test Mode",
        usage: 'POST with { "articleId": "your-article-id" }',
        example: 'POST { "articleId": "92275" }',
        timestamp: new Date().toISOString(),
      });
    }

    // Test mode - just check if file exists
    console.log(`🔍 Test mode: Checking for GLB file: ${articleId}.glb`);

    const drive = initializeDriveAPI();
    const fileId = await findGLBFile(drive, articleId);

    return NextResponse.json({
      message: "GLB file search test",
      articleId,
      found: !!fileId,
      fileId: fileId || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("❌ GLB test error:", errorMessage);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
