import { apiRequest } from "./api-client";
import type { AgentRequest, AgentResponse } from "@/types";

export function sendAgentMessage(request: AgentRequest) {
  return apiRequest<AgentResponse>("/agent/message", {
    method: "POST",
    body: request,
  });
}
