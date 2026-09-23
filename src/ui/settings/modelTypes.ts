export interface CustomModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
}
export interface Provider {
  name: string;
  baseUrl?: string;
  api?: string;
  models: CustomModel[];
  hasAdvancedSettings: boolean;
}
export interface Config {
  path: string;
  providers: Provider[];
  imported?: number;
}
export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}
export const blankModel = {
  id: "",
  name: "",
  reasoning: false,
  image: false,
  contextWindow: "",
  maxTokens: "",
};
