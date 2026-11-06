/** Never expose provider messages, transactions or credentials in rejection logs. */
export function gateFailureCode(error: unknown): string {
  const reason = error instanceof Error ? error.message : '';
  switch (reason) {
    case 'Delegated trade over_budget':
      return 'over_budget';
    case 'Delegated trade inactive':
    case 'Delegation is inactive or exceeds owner-only limits':
      return 'inactive_delegation';
    case 'Headless Jupiter requires existing source and destination token accounts':
    case 'Stock mint uses an unsupported token program':
      return 'unsupported_route';
    case 'This transaction could not be simulated. Check your USDC and SOL balances and request a fresh quote.':
      return 'simulation_failed';
    case 'Transaction expired. Request a fresh quote.':
      return 'transaction_expired';
    case 'This trade no longer matches the terms you reviewed. Review a fresh quote.':
    case 'Fresh Jupiter quote moved outside the reviewed terms':
      return 'reviewed_terms_changed';
    case 'Prepared intent is unavailable for delegation':
      return 'intent_unavailable';
    case 'A newly consented execute connection is required':
      return 'fresh_connection_required';
    default:
      return 'gate_rejected';
  }
}
