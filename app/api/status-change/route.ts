//app\api\status-change\route.ts

import { NextRequest, NextResponse } from "next/server";
import globalQueue, { QAJobInput } from "lib/queue";

// In-memory storage for recent status changes
const recentChanges: any[] = [];
const MAX_STORED_CHANGES = 100;

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

export async function POST(request: NextRequest) {
  console.log("🔄 POST request received at /api/status-change");

  try {
    const body = await request.json();
    console.log("📨 Received body:", JSON.stringify(body, null, 2));

    const {
      articleId,
      productName,
      status,
      oldStatus,
      references = [],
      sheetId,
      sheetName,
      rowIndex,
      timestamp,
      triggerType,
    } = body;

    // Create status change object
    const statusChange = {
      articleId: articleId || "Unknown",
      productName: productName || "Unknown Product",
      status: status || "Unknown Status",
      oldStatus: oldStatus || "Unknown",
      references: Array.isArray(references) ? references : [],
      sheetId: sheetId || "Unknown",
      sheetName: sheetName || "Unknown Sheet",
      rowIndex: rowIndex || 0,
      timestamp: timestamp || new Date().toISOString(),
      triggerType: triggerType || "unknown",
      shouldStartQA:
        status === "Delivered by Artist" ||
        status === "Deliver" ||
        status.toLowerCase().includes("deliver"),
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Unique ID for frontend
    };

    // Add to the beginning of the array (newest first)
    recentChanges.unshift(statusChange);

    // Keep only the most recent changes
    if (recentChanges.length > MAX_STORED_CHANGES) {
      recentChanges.splice(MAX_STORED_CHANGES);
    }

    // Print the status change information to console
    console.log("=".repeat(50));
    console.log("📋 STATUS CHANGE DETECTED");
    console.log("=".repeat(50));
    console.log(`🆔 Article ID: ${articleId}`);
    console.log(`🏷️  Product: ${productName}`);
    console.log(`📊 Old Status: ${oldStatus} → New Status: ${status}`);
    console.log(`📄 Sheet: ${sheetName} (ID: ${sheetId})`);
    console.log(`📍 Row: ${rowIndex}`);
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log(`🖼️  Reference Images (${references.length}):`);
    references.forEach((ref: string, i: number) => {
      console.log(`   ${i + 1}. ${ref}`);
    });
    console.log(`🔧 Trigger Type: ${triggerType}`);
    console.log("=".repeat(50));

    let queueJob = null;

    // Check if this should trigger QA processing
    if (statusChange.shouldStartQA) {
      console.log("🚀 QA PROCESSING SHOULD START!");
      console.log(`   Processing article: ${articleId}`);
      console.log(`   Product: ${productName}`);
      console.log(`   With ${references.length} reference images`);

      try {
        // Add job to the processing queue
        const jobInput: QAJobInput = {
          articleId: articleId,
          productName: productName,
          references: references,
          sheetId: sheetId,
          rowIndex: rowIndex,
        };

        queueJob = globalQueue.addJob(jobInput);

        console.log(`✅ Job added to queue: ${queueJob.id}`);
        console.log(`📊 Queue status:`, globalQueue.getQueueStatus());
      } catch (queueError) {
        console.error("❌ Error adding job to queue:", queueError);
        // Don't fail the entire request if queue fails
      }
    }

    console.log(`📊 Total stored changes: ${recentChanges.length}`);

    const response = NextResponse.json({
      status: "success",
      message: `Status change logged for article ${articleId}`,
      received_status: status,
      articleId: articleId,
      referenceCount: references.length,
      shouldStartQA: statusChange.shouldStartQA,
      timestamp: statusChange.timestamp,
      changeId: statusChange.id,
      // Include queue job info if created
      queueJob: queueJob
        ? {
            id: queueJob.id,
            status: queueJob.status,
            createdAt: queueJob.createdAt,
          }
        : null,
      queueStatus: globalQueue.getQueueStatus(),
    });

    return addCorsHeaders(response);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error handling status change: ${errorMessage}`);

    const response = NextResponse.json(
      {
        status: "error",
        message: errorMessage,
      },
      { status: 500 }
    );

    return addCorsHeaders(response);
  }
}

// Handle GET requests - return recent changes for frontend
export async function GET(request: NextRequest) {
  console.log("🔄 GET request received at /api/status-change");

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const since = url.searchParams.get("since"); // ISO timestamp for polling

    let filteredChanges = recentChanges;

    // Filter by timestamp if 'since' parameter is provided
    if (since) {
      const sinceDate = new Date(since);
      filteredChanges = recentChanges.filter(
        (change) => new Date(change.timestamp) > sinceDate
      );
    }

    // Limit the number of results
    const limitedChanges = filteredChanges.slice(0, limit);

    console.log(
      `📊 Returning ${limitedChanges.length} changes (total: ${recentChanges.length})`
    );

    const response = NextResponse.json({
      message: "Status change endpoint is working!",
      endpoint: "/api/status-change",
      method: "POST required for status changes",
      timestamp: new Date().toISOString(),
      recentChangesCount: recentChanges.length,
      recentChanges: limitedChanges,
      hasMore: recentChanges.length > limit,
      // Include current queue status
      queueStatus: globalQueue.getQueueStatus(),
    });

    return addCorsHeaders(response);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.log(`❌ Error handling GET request: ${errorMessage}`);

    const response = NextResponse.json(
      {
        status: "error",
        message: errorMessage,
      },
      { status: 500 }
    );

    return addCorsHeaders(response);
  }
}
