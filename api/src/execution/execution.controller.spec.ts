import { ExecutionController } from './execution.controller';

describe('ExecutionController', () => {
  const execution = {
    getQuote: jest.fn(),
    prepare: jest.fn(),
    confirm: jest.fn(),
    createBasket: jest.fn(),
    prepareBasketPurchase: jest.fn(),
  };

  let controller: ExecutionController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ExecutionController(execution as never);
  });

  it('delegates basket creation to ExecutionService', async () => {
    execution.createBasket.mockResolvedValue({ id: 'basket-1' });

    await expect(
      controller.basket({
        amountUsd: 100,
        prompt: 'Build a basket',
      }),
    ).resolves.toEqual({ id: 'basket-1' });

    expect(execution.createBasket).toHaveBeenCalledWith({
      amountUsd: 100,
      prompt: 'Build a basket',
      candidates: undefined,
    });
  });

  it('delegates basket preparation to ExecutionService', async () => {
    execution.prepareBasketPurchase.mockResolvedValue({
      basketId: 'basket-1',
      transactions: [],
    });

    await expect(
      controller.prepareBasket({
        basketId: 'basket-1',
        wallet: '11111111111111111111111111111111',
      }),
    ).resolves.toEqual({
      basketId: 'basket-1',
      transactions: [],
    });

    expect(execution.prepareBasketPurchase).toHaveBeenCalledWith({
      basketId: 'basket-1',
      wallet: '11111111111111111111111111111111',
    });
  });
});
