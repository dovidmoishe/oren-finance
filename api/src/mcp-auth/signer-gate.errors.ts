export class SignerGateRejection extends Error {
  constructor(readonly code: string) {
    super(`Signer gate: ${code}`);
  }
}
