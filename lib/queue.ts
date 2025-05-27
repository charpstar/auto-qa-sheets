// lib/queue.ts

export interface QAJobInput {
  articleId: string;
  productName: string;
  references: string[];
  sheetId?: string;
  rowIndex?: number;
}

export interface QAJob {
  id: string;
  articleId: string;
  productName: string;
  references: string[];
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retries: number;
  maxRetries: number;
  error?: string;
  screenshots?: string[];
  modelStats?: {
    meshCount: number;
    materialCount: number;
    vertices: number;
    triangles: number;
    doubleSidedCount: number;
    doubleSidedMaterials: string[];
    fileSize: number;
  };
  aiAnalysis?: {
    differences: Array<{
      renderIndex: number;
      referenceIndex: number;
      issues: string[];
      bbox: [number, number, number, number];
      severity: "low" | "medium" | "high";
    }>;
    summary: string;
    status: "Approved" | "Not Approved";
    scores?: {
      silhouette: number;
      proportion: number;
      colorMaterial: number;
      overall: number;
    };
  };
  pdfUrl?: string;
  sheetId?: string;
  rowIndex?: number;
  processingLogs: string[];
}

class JobQueue {
  private jobs: Map<string, QAJob> = new Map();
  private queue: string[] = []; // Array of job IDs in order
  private isProcessing = false;
  private maxConcurrentJobs = 1; // Process one at a time initially
  private readonly MAX_JOBS = 100;

  // Add a new job to the queue
  addJob(jobData: QAJobInput): QAJob {
    const jobId = `${jobData.articleId}-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 6)}`;

    // Check if job for this articleId already exists and is pending/processing
    const existingJob = this.findJobByArticleId(jobData.articleId);
    if (
      existingJob &&
      (existingJob.status === "pending" || existingJob.status === "processing")
    ) {
      console.log(
        `⚠️ Job for Article ID ${jobData.articleId} already exists with status: ${existingJob.status}`
      );
      return existingJob;
    }

    const job: QAJob = {
      id: jobId,
      articleId: jobData.articleId,
      productName: jobData.productName,
      references: jobData.references,
      status: "pending",
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: 3,
      sheetId: jobData.sheetId,
      rowIndex: jobData.rowIndex,
      processingLogs: [`Job created for Article ID: ${jobData.articleId}`],
    };

    this.jobs.set(jobId, job);
    this.queue.push(jobId);

    // Clean up old jobs if we exceed max
    this.cleanupOldJobs();

    console.log(
      `✅ Added job to queue: ${jobId} (Article: ${jobData.articleId})`
    );
    console.log(`📊 Queue status: ${this.queue.length} pending jobs`);

    // Start processing if not already running
    this.startProcessing();

    return job;
  }

  // Find job by Article ID
  findJobByArticleId(articleId: string): QAJob | undefined {
    for (const job of this.jobs.values()) {
      if (job.articleId === articleId) {
        return job;
      }
    }
    return undefined;
  }

  // Get job by ID
  getJob(jobId: string): QAJob | undefined {
    return this.jobs.get(jobId);
  }

  // Get all jobs (for monitoring)
  getAllJobs(): QAJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // Get queue status
  getQueueStatus() {
    const pending = this.queue.length;
    const processing = Array.from(this.jobs.values()).filter(
      (job) => job.status === "processing"
    ).length;
    const completed = Array.from(this.jobs.values()).filter(
      (job) => job.status === "completed"
    ).length;
    const failed = Array.from(this.jobs.values()).filter(
      (job) => job.status === "failed"
    ).length;

    return {
      pending,
      processing,
      completed,
      failed,
      total: this.jobs.size,
      isProcessing: this.isProcessing,
    };
  }

  // Start the processing loop
  private async startProcessing() {
    if (this.isProcessing) {
      return; // Already processing
    }

    this.isProcessing = true;
    console.log("🚀 Starting job queue processor...");

    while (this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) continue;

      const job = this.jobs.get(jobId);
      if (!job) continue;

      try {
        await this.processJob(job);
      } catch (error) {
        console.error(`❌ Error processing job ${jobId}:`, error);
        this.handleJobError(
          job,
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      // Small delay between jobs to prevent overwhelming the system
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.isProcessing = false;
    console.log("✅ Job queue processor finished");
  }

  // Process a single job
  private async processJob(job: QAJob) {
    console.log(`🔄 Processing job: ${job.id} (Article: ${job.articleId})`);

    job.status = "processing";
    job.startedAt = new Date().toISOString();
    job.processingLogs.push(`Started processing at ${job.startedAt}`);

    try {
      // Call the actual processing function
      const result: {
        screenshots: string[];
        modelStats?: any;
        aiAnalysis?: any;
        pdfUrl?: string;
      } = await this.executeQAProcessing(job);

      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.screenshots = result.screenshots;
      job.modelStats = result.modelStats;
      job.aiAnalysis = result.aiAnalysis;
      job.pdfUrl = result.pdfUrl;
      job.processingLogs.push(`Completed successfully at ${job.completedAt}`);
      job.processingLogs.push(
        `Generated ${result.screenshots.length} screenshots`
      );

      if (result.aiAnalysis) {
        job.processingLogs.push(`AI Analysis: ${result.aiAnalysis.status}`);
      }

      if (result.pdfUrl) {
        job.processingLogs.push(`PDF Report: ${result.pdfUrl}`);
      }

      if (result.modelStats) {
        job.processingLogs.push(
          `Model Stats: ${result.modelStats.vertices} vertices, ${result.modelStats.triangles} triangles`
        );
      }

      // Update Google Sheet with results
      if (job.sheetId && job.rowIndex && result.pdfUrl) {
        job.processingLogs.push("Updating Google Sheet with PDF link...");
        try {
          await this.updateGoogleSheet(job);
          job.processingLogs.push("✅ Google Sheet updated successfully");
        } catch (sheetError) {
          const errorMsg = `Sheet update failed: ${
            sheetError instanceof Error ? sheetError.message : "Unknown error"
          }`;
          job.processingLogs.push(`⚠️ ${errorMsg}`);
          // Don't fail the entire job if sheet update fails
        }
      }

      console.log(`✅ Job completed: ${job.id}`);
    } catch (error) {
      this.handleJobError(
        job,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  // Update Google Sheet with QA results
  private async updateGoogleSheet(job: QAJob): Promise<void> {
    if (!job.sheetId || !job.rowIndex) {
      throw new Error("Missing sheet information for update");
    }

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL
      ? process.env.NEXT_PUBLIC_BASE_URL
      : "http://localhost:3000";

    const updatePayload = {
      articleId: job.articleId,
      sheetId: job.sheetId,
      rowIndex: job.rowIndex,
      pdfUrl: job.pdfUrl,
      status: job.aiAnalysis?.status,
      summary: job.aiAnalysis?.summary,
    };

    console.log("📊 Calling sheet update API with:", updatePayload);

    const response = await fetch(`${baseUrl}/api/update-sheet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Sheet update API failed: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log("✅ Sheet update API response:", result);
  }

  // Handle job errors and retries
  private handleJobError(job: QAJob, errorMessage: string) {
    job.retries++;
    job.error = errorMessage;
    job.processingLogs.push(`Error (attempt ${job.retries}): ${errorMessage}`);

    if (job.retries < job.maxRetries) {
      job.status = "pending";
      this.queue.push(job.id); // Re-add to queue for retry
      job.processingLogs.push(
        `Retry scheduled (${job.retries}/${job.maxRetries})`
      );
      console.log(
        `🔄 Job ${job.id} will be retried (${job.retries}/${job.maxRetries})`
      );
    } else {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.processingLogs.push(
        `Failed permanently after ${job.retries} attempts`
      );
      console.log(
        `❌ Job ${job.id} failed permanently after ${job.retries} attempts`
      );
    }
  }

  // The actual QA processing logic
  // Updated executeQAProcessing method in lib/queue.ts

  private async executeQAProcessing(job: QAJob): Promise<{
    screenshots: string[];
    modelStats?: any;
    aiAnalysis?: any;
    pdfUrl?: string;
  }> {
    // Import the screenshot processor, AI analyzer, and PDF generator
    const { screenshotProcessor } = await import("./screenshotProcessor");
    const { aiAnalyzer } = await import("./aiAnalysis");
    const { generateQAReport } = await import("./pdfGenerator");

    // Step 1: Process screenshots using the dedicated processor
    job.processingLogs.push("Starting screenshot generation...");
    const screenshotResult = await screenshotProcessor.processScreenshots(job);

    // Add processing logs to the job
    job.processingLogs.push(...screenshotResult.processingLogs);

    let aiAnalysisResult = null;
    let pdfUrl: string | undefined = undefined;

    // Step 2: Run AI analysis on screenshots vs references
    if (screenshotResult.screenshots.length > 0 && job.references.length > 0) {
      job.processingLogs.push(
        `Starting AI analysis with ${screenshotResult.screenshots.length} screenshots and ${job.references.length} references...`
      );

      // Log model stats if available
      if (screenshotResult.modelStats) {
        const fileSizeMB = (
          screenshotResult.modelStats.fileSize /
          (1024 * 1024)
        ).toFixed(2);
        job.processingLogs.push(
          `Model statistics: ${screenshotResult.modelStats.triangles} triangles, ${screenshotResult.modelStats.meshCount} meshes, ${screenshotResult.modelStats.materialCount} materials, ${fileSizeMB}MB`
        );
      }

      try {
        aiAnalysisResult = await aiAnalyzer.analyzeScreenshots({
          screenshots: screenshotResult.screenshots,
          references: job.references,
          articleId: job.articleId,
          productName: job.productName,
          modelStats: screenshotResult.modelStats, // 🔥 Pass model stats to AI
        });

        job.processingLogs.push("✅ AI analysis completed successfully");
        job.processingLogs.push(`Analysis status: ${aiAnalysisResult.status}`);
        job.processingLogs.push(
          `Found ${aiAnalysisResult.differences.length} differences`
        );

        if (aiAnalysisResult.scores) {
          job.processingLogs.push(
            `Similarity scores - Silhouette: ${aiAnalysisResult.scores.silhouette}%, Proportion: ${aiAnalysisResult.scores.proportion}%, Color/Material: ${aiAnalysisResult.scores.colorMaterial}%, Overall: ${aiAnalysisResult.scores.overall}%`
          );
        }

        // Step 3: Generate PDF report if AI analysis succeeded
        job.processingLogs.push("Starting PDF report generation...");

        try {
          // Temporarily store AI analysis in job for PDF generation
          job.aiAnalysis = aiAnalysisResult;
          job.screenshots = screenshotResult.screenshots;
          job.modelStats = screenshotResult.modelStats;
          const pdfResult = await generateQAReport(job);
          pdfUrl = pdfResult.pdfUrl;

          job.processingLogs.push(...pdfResult.processingLogs);
          job.processingLogs.push(`✅ PDF report generated: ${pdfUrl}`);
        } catch (pdfError) {
          const errorMsg = `PDF generation failed: ${
            pdfError instanceof Error ? pdfError.message : "Unknown error"
          }`;
          job.processingLogs.push(`❌ ${errorMsg}`);
          // Continue without PDF rather than failing the entire job
          job.processingLogs.push("⚠️ Continuing without PDF report");
        }
      } catch (aiError) {
        const errorMsg = `AI analysis failed: ${
          aiError instanceof Error ? aiError.message : "Unknown error"
        }`;
        job.processingLogs.push(`❌ ${errorMsg}`);

        // Continue without AI analysis rather than failing the entire job
        job.processingLogs.push(
          "⚠️ Continuing without AI analysis and PDF report"
        );
      }
    } else {
      job.processingLogs.push(
        "⚠️ Skipping AI analysis and PDF generation - no screenshots or references available"
      );
    }

    return {
      screenshots: screenshotResult.screenshots,
      modelStats: screenshotResult.modelStats, // 🔥 Return model stats
      aiAnalysis: aiAnalysisResult,
      pdfUrl: pdfUrl || undefined,
    };
  }

  // Clean up old completed/failed jobs
  private cleanupOldJobs() {
    if (this.jobs.size <= this.MAX_JOBS) return;

    const jobsArray = Array.from(this.jobs.entries()).sort(
      ([, a], [, b]) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // Keep only the most recent MAX_JOBS
    const jobsToRemove = jobsArray.slice(0, jobsArray.length - this.MAX_JOBS);

    for (const [jobId] of jobsToRemove) {
      if (this.jobs.get(jobId)?.status !== "processing") {
        this.jobs.delete(jobId);
      }
    }

    console.log(`🧹 Cleaned up ${jobsToRemove.length} old jobs`);
  }
}

// Global singleton instance
const globalQueue = new JobQueue();
export default globalQueue;
