import {
  useState,
  useEffect,
  useCallback
} from 'react';
import {
  Settings2,
  Shuffle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const STORAGE_KEY = 'password-generator-policy';

interface PasswordPolicy {
  length: number;
  includeLetters: boolean;
  includeNumbers: boolean;
  includeSpecial: boolean;
  excludeAmbiguous: boolean;
  minPerCategory: number;
}

const DEFAULT_POLICY: PasswordPolicy = {
  length: 20,
  includeLetters: true,
  includeNumbers: true,
  includeSpecial: true,
  excludeAmbiguous: true,
  minPerCategory: 1,
};

const CHARS = {
  letters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lettersNoAmbiguous: 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ',
  numbers: '0123456789',
  numbersNoAmbiguous: '23456789',
  special: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  specialNoAmbiguous: '!@#$%^&*_+-=;:,.<>?',
};

// Ambiguous characters: 0, O, o, l, 1, I, |, (), [], {}
const AMBIGUOUS_CHARS = '0OolI1|()[]{}';

interface PasswordGeneratorProps {
  onGenerate: (password: string) => void;
}

export function PasswordGenerator({ onGenerate }: PasswordGeneratorProps) {
  const [policy, setPolicy] = useState<PasswordPolicy>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return { ...DEFAULT_POLICY, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_POLICY;
      }
    }
    return DEFAULT_POLICY;
  });

  const [open, setOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Save policy to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
  }, [policy]);

  // Validate minimum requirements vs length
  useEffect(() => {
    const enabledCategories = [policy.includeLetters, policy.includeNumbers, policy.includeSpecial].filter(Boolean).length;
    const minRequired = enabledCategories * policy.minPerCategory;

    if (enabledCategories === 0) {
      setValidationError('Enable at least one character category');
    } else if (minRequired > policy.length) {
      setValidationError(`Minimum requirements (${minRequired}) exceed password length (${policy.length})`);
    } else {
      setValidationError(null);
    }
  }, [policy]);

  const generatePassword = useCallback(() => {
    if (validationError) return;

    const useAmbiguous = !policy.excludeAmbiguous;

    const letters = useAmbiguous ? CHARS.letters : CHARS.lettersNoAmbiguous;
    const numbers = useAmbiguous ? CHARS.numbers : CHARS.numbersNoAmbiguous;
    const special = useAmbiguous ? CHARS.special : CHARS.specialNoAmbiguous;

    let result: string[] = [];

    // Add minimum required characters from each enabled category
    if (policy.includeLetters) {
      for (let i = 0; i < policy.minPerCategory; i++) {
        result.push(letters.charAt(Math.floor(Math.random() * letters.length)));
      }
    }
    if (policy.includeNumbers) {
      for (let i = 0; i < policy.minPerCategory; i++) {
        result.push(numbers.charAt(Math.floor(Math.random() * numbers.length)));
      }
    }
    if (policy.includeSpecial) {
      for (let i = 0; i < policy.minPerCategory; i++) {
        result.push(special.charAt(Math.floor(Math.random() * special.length)));
      }
    }

    // Build pool for remaining characters
    let pool = '';
    if (policy.includeLetters) pool += letters;
    if (policy.includeNumbers) pool += numbers;
    if (policy.includeSpecial) pool += special;

    // Fill remaining length with random characters from pool
    const remaining = policy.length - result.length;
    for (let i = 0; i < remaining; i++) {
      result.push(pool.charAt(Math.floor(Math.random() * pool.length)));
    }

    // Shuffle the result
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    onGenerate(result.join(''));
  }, [policy, validationError, onGenerate]);

  const updatePolicy = (updates: Partial<PasswordPolicy>) => {
    setPolicy(prev => ({ ...prev, ...updates }));
  };

  const enabledCategories = [policy.includeLetters, policy.includeNumbers, policy.includeSpecial].filter(Boolean).length;
  const maxMinPerCategory = enabledCategories > 0 ? Math.floor(policy.length / enabledCategories) : 0;

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" title="Password settings">
            <Settings2 className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Password Policy</h4>

            {/* Length */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Length</Label>
                <span className="text-xs text-muted-foreground font-mono">{policy.length}</span>
              </div>
              <Slider
                value={[policy.length]}
                onValueChange={([val]) => updatePolicy({ length: val })}
                min={4}
                max={64}
                step={1}
              />
            </div>

            {/* Character categories */}
            <div className="space-y-3">
              {/* Letters */}
              <div className="flex items-center gap-2">
                <Switch
                  checked={policy.includeLetters}
                  onCheckedChange={checked => updatePolicy({ includeLetters: checked })}
                  id="include-letters"
                />
                <Label htmlFor="include-letters" className="text-xs">Letters (a-z, A-Z)</Label>
              </div>

              {/* Numbers */}
              <div className="flex items-center gap-2">
                <Switch
                  checked={policy.includeNumbers}
                  onCheckedChange={checked => updatePolicy({ includeNumbers: checked })}
                  id="include-numbers"
                />
                <Label htmlFor="include-numbers" className="text-xs">Numbers (0-9)</Label>
              </div>

              {/* Special */}
              <div className="flex items-center gap-2">
                <Switch
                  checked={policy.includeSpecial}
                  onCheckedChange={checked => updatePolicy({ includeSpecial: checked })}
                  id="include-special"
                />
                <Label htmlFor="include-special" className="text-xs">Special (!@#$...)</Label>
              </div>

              {/* Min per category */}
              {enabledCategories > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Label className="text-xs whitespace-nowrap">Min per category:</Label>
                  <Input
                    type="number"
                    value={policy.minPerCategory}
                    onChange={e => updatePolicy({ minPerCategory: Math.max(0, Math.min(maxMinPerCategory, parseInt(e.target.value) || 0)) })}
                    className="h-7 w-16 text-xs"
                    min={0}
                    max={maxMinPerCategory}
                  />
                </div>
              )}

              {/* Exclude Ambiguous */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Switch
                  checked={policy.excludeAmbiguous}
                  onCheckedChange={checked => updatePolicy({ excludeAmbiguous: checked })}
                  id="exclude-ambiguous"
                />
                <Label htmlFor="exclude-ambiguous" className="text-xs">
                  Exclude ambiguous (0, O, l, 1, I...)
                </Label>
              </div>
            </div>

            {/* Validation error */}
            {validationError && (
              <p className="text-xs text-destructive">{validationError}</p>
            )}

            {/* Generate button in popover */}
            <Button
              type="button"
              className="w-full"
              size="sm"
              onClick={() => {
                generatePassword();
                setOpen(false);
              }}
              disabled={!!validationError}
            >
              <Shuffle className="h-4 w-4 mr-2" />
              Generate Password
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={generatePassword}
        title="Generate password"
        disabled={!!validationError}
      >
        <Shuffle className="h-4 w-4" />
      </Button>
    </div>
  );
}
