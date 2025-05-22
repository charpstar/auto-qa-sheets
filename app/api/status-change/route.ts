import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      articleId,
      status,
      references = [],
      sheetId,
      rowIndex,
      timestamp,
    } = body;

    // Print the status change information to console
    console.log("=".repeat(50));
    console.log("📋 STATUS CHANGE DETECTED");
    console.log("=".repeat(50));
    console.log(`🆔 Article ID: ${articleId}`);
    console.log(`📊 New Status: ${status}`);
    console.log(`📄 Sheet ID: ${sheetId}`);
    console.log(`📍 Row: ${rowIndex}`);
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log(`🖼️  Reference Images (${references.length}):`);
    references.forEach((ref: string, i: number) => {
      console.log(`   ${i + 1}. ${ref}`);
    });
    console.log("=".repeat(50));

    // Check if this should trigger QA processing
    if (status === "Delivered by Artist") {
      console.log("🚀 QA PROCESSING SHOULD START!");
      console.log(`   Processing article: ${articleId}`);
      console.log(`   With ${references.length} reference images`);

      // TODO: Later you can integrate your existing model-viewer logic here
      // For now, just log that QA should start
    }

    return NextResponse.json({
      status: "success",
      message: `Status change logged for article ${articleId}`,
      received_status: status,
      articleId: articleId,
      referenceCount: references.length,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error handling status change: ${errorMessage}`);

    return NextResponse.json(
      {
        status: "error",
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Handle GET requests (for testing)
export async function GET() {
  return NextResponse.json({
    message: "Status change endpoint - use POST method",
    endpoint: "/api/status-change",
    method: "POST",
  });
}
