import { analyzeSignals } from "@/server/analysis/signals-service";
import {
  createApiRequestContext,
  errorResponse,
  logRequest,
  readJsonBody,
  successResponse,
} from "../http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const context = createApiRequestContext();
  try {
    const body = await readJsonBody(request);
    const result = await analyzeSignals(body, {
      requestId: () => context.requestId,
    });
    logRequest(context, 200, "OK");
    return successResponse(result);
  } catch (error) {
    return errorResponse(error, context);
  }
}
