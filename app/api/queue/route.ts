//app\api\queue\route.ts

import { NextRequest, NextResponse } from "next/server";
import globalQueue from "lib/queue";

export const dynamic = "force-dynamic";

// GET: Get queue status and jobs
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const articleId = url.searchParams.get("articleId");
    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") || "50");

    // Get specific job by ID
    if (jobId) {
      const job = globalQueue.getJob(jobId);
      if (!job) {
        return NextResponse.json(
          { error: `Job not found: ${jobId}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ job });
    }

    // Get job by Article ID
    if (articleId) {
      const job = globalQueue.findJobByArticleId(articleId);
      if (!job) {
        return NextResponse.json(
          { error: `No job found for Article ID: ${articleId}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ job });
    }

    // Get all jobs with optional filtering
    let jobs = globalQueue.getAllJobs();

    // Filter by status if provided
    if (status) {
      jobs = jobs.filter((job) => job.status === status);
    }

    // Limit results
    jobs = jobs.slice(0, limit);

    const queueStatus = globalQueue.getQueueStatus();

    return NextResponse.json({
      queueStatus,
      jobs,
      totalJobs: jobs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Queue API error:", errorMessage);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// POST: Manually add job to queue (for testing)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { articleId, productName, references } = body;

    if (!articleId || !productName) {
      return NextResponse.json(
        { error: "articleId and productName are required" },
        { status: 400 }
      );
    }

    const job = globalQueue.addJob({
      articleId,
      productName,
      references: references || [],
    });

    return NextResponse.json({
      message: "Job added to queue successfully",
      job: {
        id: job.id,
        articleId: job.articleId,
        status: job.status,
        createdAt: job.createdAt,
      },
      queueStatus: globalQueue.getQueueStatus(),
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Queue POST error:", errorMessage);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
