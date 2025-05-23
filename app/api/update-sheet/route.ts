//app/api/update-sheet/route.ts

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Add CORS headers to all responses
function addCorsHeaders(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, User-Agent, Accept"
  );
  return response;
}

// Handle preflight OPTIONS requests
export async function OPTIONS(request: NextRequest) {
  console.log("🔄 OPTIONS request received (CORS preflight)");
  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response);
}

// Update Google Sheet with QA results
export async function POST(request: NextRequest) {
  console.log("🔄 POST request received at /api/update-sheet");

  try {
    const body = await request.json();
    console.log("📨 Received update request:", JSON.stringify(body, null, 2));

    const { articleId, sheetId, rowIndex, pdfUrl, status, summary } = body;

    // Validate required fields
    if (!articleId || !sheetId || !rowIndex) {
      return NextResponse.json(
        { error: "Missing required fields: articleId, sheetId, rowIndex" },
        { status: 400 }
      );
    }

    // Create the update message for the QA column
    let qaMessage = "";

    if (pdfUrl) {
      // If we have a PDF, create a link with status
      const statusText =
        status === "Approved" ? "✅ APPROVED" : "❌ NEEDS REVIEW";
      qaMessage = `${statusText} - QA Report: ${pdfUrl}`;
    } else if (status) {
      // If no PDF but we have status, just show the status
      qaMessage = `QA Completed: ${status}`;
    } else {
      // Fallback message
      qaMessage = `QA Processed - ${new Date().toLocaleString()}`;
    }

    // Prepare the Google Apps Script URL
    // You'll need to deploy this as a web app from your Google Apps Script
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_WEB_APP_URL;

    if (!GOOGLE_SCRIPT_URL) {
      console.error("❌ GOOGLE_SCRIPT_WEB_APP_URL not configured");
      return NextResponse.json(
        { error: "Google Script integration not configured" },
        { status: 500 }
      );
    }

    // Call Google Apps Script to update the sheet
    console.log(
      `📊 Updating sheet ${sheetId}, row ${rowIndex} with: ${qaMessage}`
    );

    const scriptResponse = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "updateQAColumn",
        sheetId: sheetId,
        rowIndex: rowIndex,
        message: qaMessage,
        articleId: articleId,
      }),
    });

    if (!scriptResponse.ok) {
      const errorText = await scriptResponse.text();
      throw new Error(
        `Google Script call failed: ${scriptResponse.status} - ${errorText}`
      );
    }

    const scriptResult = await scriptResponse.json();
    console.log("✅ Google Sheet updated successfully:", scriptResult);

    const response = NextResponse.json({
      success: true,
      message: "Sheet updated successfully",
      articleId: articleId,
      updatedMessage: qaMessage,
      scriptResult: scriptResult,
    });

    return addCorsHeaders(response);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Error updating sheet:", errorMessage);

    const response = NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );

    return addCorsHeaders(response);
  }
}

// GET endpoint for testing
export async function GET(request: NextRequest) {
  console.log("🔄 GET request received at /api/update-sheet");

  const response = NextResponse.json({
    message: "Google Sheets Update API",
    endpoint: "/api/update-sheet",
    method: "POST required for updates",
    requiredFields: ["articleId", "sheetId", "rowIndex"],
    optionalFields: ["pdfUrl", "status", "summary"],
    timestamp: new Date().toISOString(),
  });

  return addCorsHeaders(response);
}
