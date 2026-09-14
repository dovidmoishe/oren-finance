import { apiRequest } from "./api-client";
import type {
  BasketIntent,
  BasketResponse,
  ConfirmExecutionRequest,
  PrepareExecutionRequest,
  ExecutionStatus,
  ExecutionPreparedTransaction,
  PreparedBasketPurchase,
  QuoteResponse,
  TradeIntent,
} from "@/types";

export function getExecutionQuote(intent: TradeIntent) {
  return apiRequest<QuoteResponse>("/execution/quote", {
    method: "POST",
    body: intent,
  });
}

export function prepareExecution(request: PrepareExecutionRequest) {
  return apiRequest<ExecutionPreparedTransaction>("/execution/prepare", {
    method: "POST",
    body: request,
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

export function prepareBasket(intent: { basketId: string; wallet: string }) {
  return apiRequest<PreparedBasketPurchase>("/execution/basket/prepare", {
    method: "POST",
    body: intent,
  });
}
