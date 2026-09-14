import { apiRequest } from "./api-client";
import type {
  BasketIntent,
  BasketResponse,
  ConfirmExecutionRequest,
  ExecutionStatus,
  PreparedTransaction,
  QuoteResponse,
  TradeIntent,
} from "@/types";

export function getExecutionQuote(intent: TradeIntent) {
  return apiRequest<QuoteResponse>("/execution/quote", {
    method: "POST",
    body: intent,
  });
}

export function prepareExecution(intent: TradeIntent & { quoteId?: string }) {
  return apiRequest<PreparedTransaction>("/execution/prepare", {
    method: "POST",
    body: intent,
  });
}

export function confirmExecution(request: ConfirmExecutionRequest) {
  return apiRequest<ExecutionStatus>("/execution/confirm", {
    method: "POST",
    body: request,
  });
}

export function createBasket(intent: BasketIntent) {
  return apiRequest<BasketResponse>("/execution/basket", {
    method: "POST",
    body: intent,
  });
}

export function prepareBasket(intent: BasketIntent & { basketId?: string }) {
  return apiRequest<PreparedTransaction[]>("/execution/basket/prepare", {
    method: "POST",
    body: intent,
  });
}
