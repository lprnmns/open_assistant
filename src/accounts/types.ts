export type AccountProviderConfig = Record<string, unknown>;

export type StoredAccount = {
  id: string;
  email: string;
  emailNormalized: string;
  hashedPassword: string;
  inviteCode?: string;
  providerConfig?: AccountProviderConfig;
  createdAt: string;
};

export type CreateAccountInput = {
  email: string;
  password: string;
  inviteCode?: string;
  providerConfig?: AccountProviderConfig;
  id?: string;
  createdAt?: string;
};
