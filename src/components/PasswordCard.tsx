import { useState } from 'react';
import { PasswordEntry } from '@/types/password';
import { Copy, Eye, EyeOff, ExternalLink, Pencil, Trash2, Hash, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { QRCodeSVG } from 'qrcode.react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PasswordCardProps {
  entry: PasswordEntry;
  onEdit: (entry: PasswordEntry) => void;
  onDelete: (id: string) => void;
  onTagClick: (tag: string) => void;
}

export function PasswordCard({ entry, onEdit, onDelete, onTagClick }: PasswordCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [showQrDialog, setShowQrDialog] = useState(false);

  const isAirGapPassword = entry.password?.startsWith('oms00_');

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
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate text-foreground">{entry.title}</h3>
            {entry.url && (
              <a
                href={entry.url.startsWith('http') ? entry.url : `https://${entry.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 truncate transition-colors"
              >
                {entry.url}
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            )}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <AlertDialogTitle>Delete Entry</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{entry.title}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(entry.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {entry.username && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Username</p>
              <p className="text-sm font-mono truncate">{entry.username}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => copyToClipboard(entry.username, 'Username')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        )}

        {entry.password && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="text-sm font-mono truncate">
                {showPassword ? entry.password : maskValue(entry.password)}
              </p>
            </div>
            <div className="flex gap-1">
              {isAirGapPassword && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setShowQrDialog(true)}
                  title="Air Gap - Show QR Code"
                >
                  <QrCode className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => copyToClipboard(entry.password, 'Password')}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {entry.customFields.map(field => (
          <div key={field.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{field.label}</p>
              <p className="text-sm font-mono truncate">
                {field.isSecret && !visibleFields.has(field.id) 
                  ? maskValue(field.value) 
                  : field.value}
              </p>
            </div>
            <div className="flex gap-1">
              {field.isSecret && (
                <Button variant="ghost" size="icon" onClick={() => toggleFieldVisibility(field.id)}>
                  {visibleFields.has(field.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => copyToClipboard(field.value, field.label)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        {entry.notes && (
          <div className="p-2 rounded-md bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{entry.notes}</p>
          </div>
        )}

        {entry.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {entry.hashtags.map(tag => (
              <Badge
                key={tag}
                variant="secondary"
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={() => onTagClick(tag)}
              >
                <Hash className="h-3 w-3 mr-0.5" />
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>

      {/* Air Gap QR Code Dialog */}
      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Air Gap - QR Code
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-white rounded-lg">
              <QRCodeSVG value={entry.password} size={200} />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Scan this QR code to transfer the password securely
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
