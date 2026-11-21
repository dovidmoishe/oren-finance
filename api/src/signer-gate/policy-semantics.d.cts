export function normalizePolicySemantics(policy: {
  owner_id?: string | null;
  chain_type?: string | null;
  version?: string | null;
  rules?:
    | readonly {
        name?: string;
        method?: string;
        action?: string;
        conditions?:
          | readonly {
              field_source?: string;
              field?: string;
              operator?: string;
              value?: unknown;
              idl?: unknown;
            }[]
          | null;
      }[]
    | null;
}): {
  owner_id?: string | null;
  chain_type?: string | null;
  version?: string | null;
  rules?: {
    name?: string;
    method?: string;
    action?: string;
    conditions?: {
      field_source?: string;
      field?: string;
      operator?: string;
      value: unknown;
      idl: unknown;
    }[];
  }[];
};
