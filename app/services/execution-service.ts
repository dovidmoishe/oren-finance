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
  LimitOrderCancelConfirmResponse,
  LimitOrderConfirmResponse,
  LimitOrderIntent,
  LimitOrderProposal,
  LimitOrderRecord,
  PreparedLimitCancel,
  PreparedLimitOrder,
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

export function proposeLimitOrder(intent: LimitOrderIntent) {
  return apiRequest<LimitOrderProposal>("/execution/limit-order", {
    method: "POST",
    body: intent,
  });
}

export function prepareLimitOrder(request: {
  proposalId: string;
  wallet: string;
}) {
  return apiRequest<PreparedLimitOrder>("/execution/limit-order/prepare", {
    method: "POST",
    body: request,
  });
}

export function confirmLimitOrder(request: {
  proposalId: string;
  wallet: string;
  signature: string;
  orderKey?: string;
}) {
  return apiRequest<LimitOrderConfirmResponse>("/execution/limit-order/confirm", {
    method: "POST",
    body: request,
  });
}

export function listLimitOrders(
  wallet: string,
  options?: { includeHistory?: boolean },
) {
  const query = options?.includeHistory ? "?includeHistory=true" : "";
  return apiRequest<LimitOrderRecord[]>(
    `/execution/limit-orders/${encodeURIComponent(wallet)}${query}`,
  );
}

export function prepareCancelLimitOrder(request: {
  orderKey: string;
  wallet: string;
}) {
  return apiRequest<PreparedLimitCancel>(
    "/execution/limit-order/prepare-cancel",
    {
      method: "POST",
      body: request,
    },
  );
}

export function confirmCancelLimitOrder(request: {
  orderKey: string;
  wallet: string;
  signature: string;
}) {
  return apiRequest<LimitOrderCancelConfirmResponse>(
    "/execution/limit-order/confirm-cancel",
    {
      method: "POST",
      body: request,
    },
  );
}
