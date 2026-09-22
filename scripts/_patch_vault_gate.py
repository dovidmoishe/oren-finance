from pathlib import Path

path = Path("api/src/vault/vault.service.ts")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        "async confirmLock(input: ConfirmLockRequest): Promise<ConfirmVaultResponse> {\n"
        "    const wallet = assertPublicKey(input.wallet, 'wallet');",
        "async confirmLock(input: ConfirmLockRequest): Promise<ConfirmVaultResponse> {\n"
        "    this.assertProgramLive();\n"
        "    const wallet = assertPublicKey(input.wallet, 'wallet');",
    ),
    (
        "async prepareUnlock(input: UnlockIntent): Promise<PreparedVaultTransaction> {\n"
        "    const wallet = assertPublicKey(input.wallet, 'wallet');",
        "async prepareUnlock(input: UnlockIntent): Promise<PreparedVaultTransaction> {\n"
        "    this.assertProgramLive();\n"
        "    const wallet = assertPublicKey(input.wallet, 'wallet');",
    ),
]

# confirmUnlock may be multiline
confirm_old = None
for candidate in [
    "async confirmUnlock(\n"
    "    input: ConfirmUnlockRequest,\n"
    "  ): Promise<ConfirmVaultResponse> {\n"
    "    const wallet = assertPublicKey(input.wallet, 'wallet');",
    "async confirmUnlock(input: ConfirmUnlockRequest): Promise<ConfirmVaultResponse> {\n"
    "    const wallet = assertPublicKey(input.wallet, 'wallet');",
]:
    if candidate in text:
        confirm_old = candidate
        break

if confirm_old is None:
    raise SystemExit("confirmUnlock snippet not found")

confirm_new = confirm_old.replace(
    "{\n    const wallet",
    "{\n    this.assertProgramLive();\n    const wallet",
    1,
)
replacements.append((confirm_old, confirm_new))

for old, new in replacements:
    if "this.assertProgramLive();\n    const wallet = assertPublicKey(input.wallet" in new and new in text:
        print("already gated")
        continue
    if old not in text:
        raise SystemExit(f"Missing:\n{old}")
    text = text.replace(old, new, 1)
    print("gated ok")

method = """
  private assertProgramLive(): void {
    if (this.env.VAULT_PROGRAM_LIVE) {
      return;
    }
    throw new ServiceUnavailableException({
      statusCode: 503,
      message: VAULT_NOT_LIVE_MESSAGE,
      error: VAULT_PROGRAM_NOT_LIVE,
    });
  }

"""

if "private assertProgramLive" not in text:
    markers = [
        "  private async selectLockVariant",
        "  private async enrich(",
        "  private async getIndexedPosition",
        "  private async assertConfirmed",
        "  private confirmResponse",
    ]
    for marker in markers:
        if marker in text:
            text = text.replace(marker, method + marker, 1)
            print("inserted before", marker.strip())
            break
    else:
        raise SystemExit("no insertion marker")

path.write_text(text, encoding="utf-8")
final = path.read_text(encoding="utf-8")
print("assertProgramLive count", final.count("assertProgramLive"))
print("has private method", "private assertProgramLive" in final)
