from pathlib import Path

path = Path("api/src/vault/vault.service.spec.ts")
text = path.read_text(encoding="utf-8")

text = text.replace(
    "import { BadRequestException } from '@nestjs/common';\nimport { VaultService } from './vault.service';",
    "import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';\n"
    "import { VaultService, VAULT_PROGRAM_NOT_LIVE } from './vault.service';",
)

env_block = """  const env = {
    VAULT_PROGRAM_LIVE: true,
  };

"""

if "const env =" not in text:
    text = text.replace(
        "  const tokens = {\n    getMarketSnapshots: jest.fn(),\n    resolveMint: jest.fn(),\n  };\n\n  let service: VaultService;",
        "  const tokens = {\n    getMarketSnapshots: jest.fn(),\n    resolveMint: jest.fn(),\n  };\n"
        + env_block
        + "\n  let service: VaultService;",
    )

text = text.replace(
    """    service = new VaultService(
      repository as never,
      builder as never,
      alchemy as never,
      portfolio as never,
      tokens as never,
    );""",
    """    env.VAULT_PROGRAM_LIVE = true;
    service = new VaultService(
      repository as never,
      builder as never,
      alchemy as never,
      portfolio as never,
      tokens as never,
      env as never,
    );""",
)

extra_tests = """
  it('includes programLive=false on list when the program is not live', async () => {
    env.VAULT_PROGRAM_LIVE = false;
    repository.listByOwner.mockResolvedValue([]);

    await expect(service.listVaults(wallet)).resolves.toMatchObject({
      walletAddress: wallet,
      totalLockedValueUsd: 0,
      positions: [],
      programLive: false,
    });
  });

  it('returns 503 with VAULT_PROGRAM_NOT_LIVE when preparing a lock while not live', async () => {
    env.VAULT_PROGRAM_LIVE = false;

    await expect(
      service.prepareLock({
        action: 'lock',
        wallet,
        asset: 'NVDA',
        amount: 1,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    try {
      await service.prepareLock({
        action: 'lock',
        wallet,
        asset: 'NVDA',
        amount: 1,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      });
    } catch (error) {
      const body = (error as ServiceUnavailableException).getResponse() as {
        error?: string;
      };
      expect(body.error).toBe(VAULT_PROGRAM_NOT_LIVE);
    }

    expect(builder.buildLock).not.toHaveBeenCalled();
  });

  it('returns 503 when confirming unlock while not live', async () => {
    env.VAULT_PROGRAM_LIVE = false;

    await expect(
      service.confirmUnlock({
        wallet,
        signature: 'sig',
        lockAddress: wallet,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
"""

if "VAULT_PROGRAM_NOT_LIVE when preparing" not in text:
    if not text.rstrip().endswith("});"):
        raise SystemExit("unexpected file ending")
    # insert before final closing of describe
    idx = text.rfind("});")
    text = text[:idx] + extra_tests + "\n" + text[idx:]

path.write_text(text, encoding="utf-8")
print("spec updated")
print("env ctor", "env as never" in path.read_text(encoding="utf-8"))
