/** Extract structural RPC failure details without logging RPC payloads. */
export function simulationFailureCode(error: unknown): string {
  if (
    [
      'BlockhashNotFound',
      'AccountNotFound',
      'InsufficientFundsForFee',
      'InvalidAccountForFee',
      'AlreadyProcessed',
    ].includes(error as string)
  )
    return error as string;
  if (error && typeof error === 'object' && 'InstructionError' in error) {
    const detail = error.InstructionError;
    if (
      Array.isArray(detail) &&
      Number.isSafeInteger(detail[0]) &&
      detail[1] &&
      typeof detail[1] === 'object' &&
      Number.isSafeInteger(detail[1].Custom)
    )
      return `instruction_${detail[0]}_custom_${detail[1].Custom}`;
    return 'instruction_error';
  }
  return 'simulation_error';
}
