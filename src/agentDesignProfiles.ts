export type AgentDesignProfile = 'none' | 'normal' | 'medium' | 'max';
export const designProfileLabel = (profile: string) => profile === 'none' ? 'None' : profile === 'max' ? 'Design MAX' : profile === 'medium' ? 'Design Medium' : 'Default';
export function savedDesignProfile(value?: string, legacyMode?: string): AgentDesignProfile {
  if (value === 'none' || value === 'normal' || value === 'medium' || value === 'max') return value;
  if (value !== undefined) return 'normal';
  return legacyMode === 'fast' ? 'medium' : legacyMode === 'balanced' || legacyMode === 'quality' ? 'max' : 'normal';
}
