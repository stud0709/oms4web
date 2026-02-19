import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import { PasswordEntry } from '@/types/types';
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Pencil,
  Trash2,
  Hash,
  QrCode,
  Webhook,
  Link,
  MapPin
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { AirGapQrDialog } from '@/components/AirGapQrDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { OMS_PREFIX, OMS4WEB_REF } from "@/lib/constants";
import {
  handleIntent,
  getEnvironment
} from '@/hooks/useEncryptedVault';
import {
  ScrollArea,
  ScrollBar
} from '@/components/ui/scroll-area';

const DELETED_TAG = 'deleted';

interface PasswordCardProps {
  entry: PasswordEntry;
  onEdit: (entry: PasswordEntry) => void;
  onDelete: (id: string) => void;
  onSoftDelete: (entry: PasswordEntry) => void;
  onTagClick: (tag: string) => void;
  applyRef: (entry: PasswordEntry) => PasswordEntry;
}

export function PasswordCard({ entry, onEdit, onDelete, onSoftDelete, onTagClick, applyRef }: PasswordCardProps) {
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [qrDialogValue, setQrDialogValue] = useState<string | null>(null);
  const [referenceMode, setReferenceMode] = useState(false);

  const isDeleted = entry.hashtags.includes(DELETED_TAG);
  const env = useMemo(() => getEnvironment(), []);

  const entryToDisplay = applyRef(entry);

  const underConstruction = useCallback(() => {
    toast({
      title: 'TODO!',
      description: `Not yet implemented`,
    });
  }, [toast]);

  const handleDelete = () => {
    if (isDeleted) {
      onDelete(entryToDisplay.id);
    } else {
      onSoftDelete(entryToDisplay);
    }
  };
  const isAirGapField = (value: string) => value?.startsWith(OMS_PREFIX);

  const copyReference = (path: string, value: string) => {
    const ref = value.startsWith(OMS4WEB_REF) ?
      value /* is already a ref to another object */ :
      `${OMS4WEB_REF}$.[?(@.id=='${entryToDisplay.id}')].${path}`;
    copyToClipboard(ref, 'Reference');
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${label} copied to clipboard`,
    });
  };

  const toggleFieldVisibility = (fieldId: string) => {
    setVisibleFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  };

  const maskValue = (value: string) => '•'.repeat(Math.min(value.length, 16));

  return (
    <Card className="group transition-all duration-300 hover:shadow-glow hover:border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate text-foreground">{entryToDisplay.title}</h3>
            {entryToDisplay.url && (
              <div className="flex items-center gap-1 max-w-full">
                <a
                  href={entryToDisplay.url.startsWith('http') ? entryToDisplay.url : `https://${entryToDisplay.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors min-w-0"
                >
                  <span className="truncate">{entryToDisplay.url}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
                {!referenceMode && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => copyToClipboard(entryToDisplay.url!, 'URL')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
                {referenceMode && (
                  <>
                    {entry.url.startsWith(OMS4WEB_REF) && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={e => underConstruction()} title="Locate source">
                        <MapPin className="h-3 w-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => copyReference('url', entry.url)} title="Copy reference">
                      <Link className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 self-end sm:self-start">
            {!referenceMode && (
              <div className={`flex gap-1 ${env.android ? 'opacity-100' : "opacity-0 group-hover:opacity-100 transition-opacity"}`}>
                <Button variant="ghost" size="icon" onClick={() => onEdit(entry)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{isDeleted ? 'Permanently Delete Entry' : 'Delete Entry'}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {isDeleted
                          ? `Are you sure you want to permanently delete "${entryToDisplay.title}"? This action cannot be undone.`
                          : `"${entryToDisplay.title}" will be marked as deleted. You can restore it later or delete it permanently.`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        {isDeleted ? 'Delete Permanently' : 'Move to Deleted'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
            <div className={`transition-opacity ${(referenceMode || env.android) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setReferenceMode(prev => !prev)}
                className={referenceMode ? 'text-primary' : ''}
                title="Toggle reference mode"
              >
                <Link className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {entryToDisplay.username && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Username</p>
              <p className="text-sm font-mono truncate">{entryToDisplay.username}</p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {!referenceMode && (
                <Button variant="ghost" size="icon" onClick={() => copyToClipboard(entryToDisplay.username, 'Username')}>
                  <Copy className="h-4 w-4" />
                </Button>
              )}
              {referenceMode && (
                <>
                  {entry.username.startsWith(OMS4WEB_REF) && (
                    <Button variant="ghost" size="icon" onClick={e => underConstruction()} title="Locate source">
                      <MapPin className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => copyReference('username', entry.username)} title="Copy reference">
                    <Link className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {entryToDisplay.password && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="text-sm font-mono truncate">
                {maskValue(entryToDisplay.password)}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {!referenceMode && (
                <>
                  {!env.android && (<Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setQrDialogValue(entryToDisplay.password)}
                    title="Air Gap - Show QR Code">
                    <QrCode className="h-4 w-4" />
                  </Button>)}
                  {env.android && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleIntent(entryToDisplay.password)}>
                        <Webhook className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => copyToClipboard(entryToDisplay.password, 'Password')}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </>)}
              {referenceMode && (
                <>
                  {entry.password.startsWith(OMS4WEB_REF) && (
                    <Button variant="ghost" size="icon" onClick={e => underConstruction()} title="Locate source">
                      <MapPin className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => copyReference('password', entry.password)} title="Copy reference">
                    <Link className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {entryToDisplay.customFields.map((field, i) => (
          <div key={field.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{field.label}</p>
              <p className="text-sm font-mono truncate">
                {field.protection !== 'none' && !visibleFields.has(field.id)
                  ? maskValue(field.value)
                  : field.value}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {!referenceMode && (
                <>
                  {isAirGapField(field.value) && (
                    <>
                      {!env.android && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setQrDialogValue(field.value)}
                          title="Air Gap - Show QR Code">
                          <QrCode className="h-4 w-4" />
                        </Button>)}
                      {env.android && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleIntent(field.value)}>
                          <Webhook className="h-4 w-4" />
                        </Button>)}
                    </>
                  )}
                  {field.protection === 'secret' && (
                    <Button variant="ghost" size="icon" onClick={() => toggleFieldVisibility(field.id)}>
                      {visibleFields.has(field.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  )}
                  {(!isAirGapField(field.value) || env.android) && (
                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(field.value, field.label)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
              {referenceMode && (
                <>
                  {entry.customFields[i].value.startsWith(OMS4WEB_REF) && (
                    <Button variant="ghost" size="icon" onClick={e => underConstruction()} title="Locate source">
                      <MapPin className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => copyReference(`customFields[?(@.id == '${field.id}')]`, entry.customFields[i].value)} title="Copy reference">
                    <Link className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        {entryToDisplay.notes && (
          <div className="flex items-start justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{entryToDisplay.notes}</p>
            </div>
            {referenceMode && (
              <>
                {entry.notes.startsWith(OMS4WEB_REF) && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={e => underConstruction()} title="Locate source">
                    <MapPin className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => copyReference('notes', entry.notes)} title="Copy reference">
                  <Link className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )}

        {entryToDisplay.hashtags.length > 0 && (
          <ScrollArea className="w-px min-w-full whitespace-nowrap pt-2">
            <div className="flex w-max space-x-2 pb-3">
              {entryToDisplay.hashtags.map((tag) => (
                <Badge
                  key={tag}
                  variant={tag === DELETED_TAG ? 'destructive' : 'secondary'}
                  className={`cursor-pointer transition-colors ${tag === DELETED_TAG
                    ? 'hover:bg-destructive/80'
                    : 'hover:bg-primary hover:text-primary-foreground'
                    }`}
                  onClick={() => onTagClick(tag)}
                >
                  <Hash className="h-3 w-3 mr-0.5" />
                  {tag}
                </Badge>
              ))}
            </div>
            {/* orientation="horizontal" is the key here */}
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </CardContent>

      {/* Air Gap QR Code Dialog */}
      <AirGapQrDialog
        open={qrDialogValue !== null}
        onOpenChange={(open) => !open && setQrDialogValue(null)}
        password={qrDialogValue || ''}
      />
    </Card>
  );
}
