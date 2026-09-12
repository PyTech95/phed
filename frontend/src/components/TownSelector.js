import { useState } from 'react';
import { useTown } from '../context/TownContext';
import { useAuth } from '../context/AuthContext';
import { MapPin, ChevronDown, Check, Building2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from './ui/dropdown-menu';
import { Button } from './ui/button';

export default function TownSelector({ className = '' }) {
  const { towns, selectedTown, selectTown } = useTown();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // If user is not admin and has assigned town, they can't switch
  const canSwitchTown = user?.role === 'ADMIN' || !user?.assigned_town;
  
  // Filter towns based on user's assignment
  const availableTowns = user?.role === 'ADMIN' 
    ? towns 
    : towns.filter(t => !user?.assigned_town || t.id === user.assigned_town);

  if (towns.length === 0) {
    return null;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={!canSwitchTown}>
        <Button 
          variant="outline" 
          className={`gap-2 ${className} ${selectedTown ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}
          data-testid="town-selector"
        >
          <Building2 className="w-4 h-4" />
          <span className="max-w-[120px] truncate">
            {selectedTown ? selectedTown.name : 'Select Town'}
          </span>
          {canSwitchTown && <ChevronDown className="w-4 h-4 opacity-50" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          Select Town
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableTowns.map((town) => (
          <DropdownMenuItem
            key={town.id}
            onClick={() => {
              selectTown(town);
              setOpen(false);
              // Force page reload to re-fetch all data with new town context
              window.location.reload();
            }}
            className="flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>{town.name}</span>
              <span className="text-xs text-slate-400">({town.code})</span>
            </div>
            {selectedTown?.id === town.id && (
              <Check className="w-4 h-4 text-green-600" />
            )}
          </DropdownMenuItem>
        ))}
        {user?.role === 'ADMIN' && selectedTown && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                selectTown(null);
                setOpen(false);
              }}
              className="text-slate-500"
            >
              View All Towns
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
