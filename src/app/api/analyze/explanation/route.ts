import { generateExplanation } from "@/server/analysis/explanation-service";
import {
  createApiRequestContext,
  errorResponse,
  logRequest,
  readJsonBody,
  successResponse,
} from "../http";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request): Promise<Response> {
  const context = createApiRequestContext();
  try {
    const body = await readJsonBody(request);
    const result = await generateExplanation(body, {
      requestId: () => context.requestId,
    });
    logRequest(context, 200, "OK");
    return successResponse(result);
  } catch (error) {
    return errorResponse(error, context);
  }
}
