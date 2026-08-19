import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Search, Tag, X } from 'lucide-react';
import type { LabelUsage } from '../domain/workspace';
import { useI18n } from '../i18n';

type LabelChoice = { label: string; count?: number; create?: boolean };

type Props = {
  value: string[];
  options: LabelUsage[];
  onChange: (labels: string[]) => void;
  className?: string;
  countType?: 'task' | 'note';
};

function labelKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

export function LabelPicker({ value, options, onChange, className = '', countType = 'task' }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedKeys = useMemo(() => new Set(value.map(labelKey)), [value]);
  const cleanQuery = query.trim();
  const queryKey = labelKey(cleanQuery);
  const matchingOptions = useMemo(() => options.filter((option) => (
    !selectedKeys.has(labelKey(option.label))
    && (!queryKey || labelKey(option.label).includes(queryKey))
  )), [options, queryKey, selectedKeys]);
  const exactOption = options.find((option) => labelKey(option.label) === queryKey);
  const canCreate = Boolean(cleanQuery && !exactOption && !selectedKeys.has(queryKey));
  const choices: LabelChoice[] = [
    ...matchingOptions,
    ...(canCreate ? [{ label: cleanQuery, create: true }] : []),
  ];
  const boundedActiveIndex = choices.length > 0 ? Math.min(activeIndex, choices.length - 1) : -1;

  const selectLabel = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    const canonical = options.find((option) => labelKey(option.label) === labelKey(clean))?.label ?? clean;
    if (!selectedKeys.has(labelKey(canonical))) onChange([...value, canonical]);
    setQuery('');
    setActiveIndex(0);
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeLabel = (label: string) => {
    const key = labelKey(label);
    onChange(value.filter((candidate) => labelKey(candidate) !== key));
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (choices.length === 0) return;
      setActiveIndex((current) => event.key === 'ArrowDown'
        ? (current + 1) % choices.length
        : (current - 1 + choices.length) % choices.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const choice = choices[boundedActiveIndex];
      if (choice) selectLabel(choice.label);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  };

  const emptyMessage = options.length === 0
    ? t('No existing labels yet')
    : t('All existing labels are selected');

  return (
    <div
      className={`label-picker ${className}`.trim()}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {value.length > 0 && (
        <div className="label-picker-selected" aria-label={t('Selected labels')}>
          {value.map((label) => (
            <button type="button" key={label} onClick={() => removeLabel(label)} aria-label={t('Remove label {{name}}', { name: label })}>
              <Tag size={12} />
              <span dir="auto">{label}</span>
              <X size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="label-picker-input">
        <Search size={15} />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t('Search or create labels')}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && boundedActiveIndex >= 0 ? `${listId}-option-${boundedActiveIndex}` : undefined}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
          placeholder={t('Search or create a label…')}
        />
      </div>
      {open && (
        <div className="label-picker-menu">
          <p>{t('Existing labels')}</p>
          <div id={listId} className="label-picker-options" role="listbox" aria-label={t('Existing labels')}>
            {choices.map((choice, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === boundedActiveIndex}
                id={`${listId}-option-${index}`}
                key={`${choice.create ? 'create' : 'existing'}:${choice.label}`}
                className={`${index === boundedActiveIndex ? 'active' : ''} ${choice.create ? 'create-label-option' : ''}`.trim()}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectLabel(choice.label)}
              >
                <span className="label-picker-option-icon">{choice.create ? <Plus size={15} /> : <Tag size={15} />}</span>
                <strong dir="auto">{choice.create ? t('Create “{{name}}”', { name: choice.label }) : choice.label}</strong>
                {!choice.create && choice.count !== undefined && <small>{t(
                  countType === 'note'
                    ? choice.count === 1 ? '{{count}} note' : '{{count}} notes'
                    : choice.count === 1 ? '{{count}} task' : '{{count}} tasks',
                  { count: choice.count },
                )}</small>}
                {!choice.create && <Plus className="label-picker-option-check" size={14} />}
              </button>
            ))}
            {choices.length === 0 && <span className="label-picker-empty">{emptyMessage}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
