import { useRef, useState, type FormEvent, type ChangeEvent, type KeyboardEvent } from 'react';
import { z } from 'zod';
import { createAuctionSchema } from '../../../shared/auction';
import { categories, conditions, type DemoUser } from '../catalog';
import { fetchJson } from '../api';
import { parseStartingPrice, parseClosingTime, formatPriceInput } from '../auction-form';

type Field = 'title' | 'category' | 'description' | 'condition' | 'location' | 'price' | 'closesAt';
type FieldErrors = Partial<Record<Field, string>>;
const fieldOrder: Field[] = ['title', 'category', 'condition', 'description', 'location', 'price', 'closesAt'];

export function NewAuctionPage({ activeUser }: { activeUser: DemoUser | undefined }) {
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    setFieldErrors({});
    if (!activeUser) { setError('Select a demo user before posting.'); return; }

    const form = new FormData(event.currentTarget);
    const priceInput = event.currentTarget.elements.namedItem('price') as HTMLInputElement;
    const dateInput = event.currentTarget.elements.namedItem('closesAt') as HTMLInputElement;
    const price = parseStartingPrice(String(form.get('price') ?? ''), priceInput.validity.badInput);
    const closingTime = parseClosingTime(String(form.get('closesAt') ?? ''), dateInput.validity.badInput);
    const parsed = createAuctionSchema.safeParse({
      title: form.get('title'), category: form.get('category'), description: form.get('description'),
      condition: form.get('condition'), location: form.get('location'), startingPriceCents: price.success ? price.value : NaN,
      closesAt: closingTime.success ? closingTime.value : '',
    });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === 'startingPriceCents' ? 'price' : issue.path[0];
        if (fieldOrder.includes(field as Field) && !errors[field as Field]) errors[field as Field] = issue.message;
      }
      if (!price.success) errors.price = price.message;
      if (!closingTime.success) errors.closesAt = closingTime.message;
      setFieldErrors(errors);
      setError('Please check the highlighted fields.');
      const first = fieldOrder.find(field => errors[field]);
      if (first) event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      const result = await fetchJson('/api/auctions', z.object({ slug: z.string() }), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-demo-user-id': String(activeUser.id) },
        body: JSON.stringify(parsed.data),
      });
      window.location.assign(`/items/${result.slug}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to post auction. Please try again.');
      setPending(false);
      submitting.current = false;
    }
  }

  function formatPrice(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const formatted = formatPriceInput(input.value, input.selectionStart ?? input.value.length);
    input.value = formatted.value;
    input.setSelectionRange(formatted.caret, formatted.caret);
  }
  function skipSeparatorOnDelete(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const caret = input.selectionStart;
    if (caret === null || caret !== input.selectionEnd) return;
    if (event.key === 'Backspace' && input.value[caret - 1] === ',') input.setSelectionRange(caret - 1, caret - 1);
    if (event.key === 'Delete' && input.value[caret] === ',') input.setSelectionRange(caret + 1, caret + 1);
  }

  function validation(field: Field) {
    return { 'aria-invalid': fieldErrors[field] ? true : undefined, 'aria-describedby': fieldErrors[field] ? `${field}-error` : undefined } as const;
  }
  function feedback(field: Field) {
    return fieldErrors[field] && <span className="field-error" id={`${field}-error`}>{fieldErrors[field]}</span>;
  }
  function clearFieldFeedback(event: FormEvent<HTMLFormElement>) {
    if (!(event.target instanceof HTMLElement)) return;
    const field = event.target.getAttribute('name') as Field;
    if (!fieldErrors[field]) return;
    const remaining = { ...fieldErrors };
    delete remaining[field];
    setFieldErrors(remaining);
    if (!Object.keys(remaining).length && error === 'Please check the highlighted fields.') setError('');
  }

  return <main className="container sell-page">
    <div className="breadcrumbs"><a href="/">Home</a><span>/</span><span>Sell</span></div>
    <p className="eyebrow">Give your equipment a second life</p><h1>Post an auction</h1>
    <p>Publish immediately as <strong>{activeUser?.name ?? '…'}</strong>. Change your demo user in the footer.</p>
    <form className="listing-form" onSubmit={submit} onChange={clearFieldFeedback} noValidate aria-busy={pending}>
      <fieldset disabled={pending}>
        <legend className="sr-only">Auction details</legend>
        <div className="form-field"><label htmlFor="title">Title</label><input id="title" name="title" required maxLength={120} placeholder="What are you selling?" {...validation('title')} />{feedback('title')}</div>
        <div className="form-columns">
          <div className="form-field"><label htmlFor="category">Category</label><select id="category" name="category" required {...validation('category')}>{categories.map(c => <option key={c}>{c}</option>)}</select>{feedback('category')}</div>
          <div className="form-field"><label htmlFor="condition">Condition</label><select id="condition" name="condition" required {...validation('condition')}>{conditions.map(c => <option key={c}>{c}</option>)}</select>{feedback('condition')}</div>
        </div>
        <div className="form-field"><label htmlFor="description">Description</label><textarea id="description" name="description" required maxLength={5000} rows={5} {...validation('description')} />{feedback('description')}</div>
        <div className="form-field"><label htmlFor="location">Location</label><input id="location" name="location" required maxLength={120} placeholder="City, state or region" {...validation('location')} />{feedback('location')}</div>
        <div className="form-columns">
          <div className="form-field"><label htmlFor="price">Starting price (USD)</label><input id="price" name="price" type="text" inputMode="decimal" required placeholder="1,000.00" onChange={formatPrice} onKeyDown={skipSeparatorOnDelete} {...validation('price')} aria-describedby={fieldErrors.price ? 'price-hint price-error' : 'price-hint'} /><span className="field-hint" id="price-hint">$0.01–$1,000,000 USD</span>{feedback('price')}</div>
          <div className="form-field"><label htmlFor="closesAt">Closing time (your local time)</label><input id="closesAt" name="closesAt" type="datetime-local" required {...validation('closesAt')} />{feedback('closesAt')}</div>
        </div>
      </fieldset>
      <p>Category illustration included. Your auction becomes visible as soon as you publish.</p>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button className="primary-button" type="submit" disabled={pending || !activeUser}>{pending ? 'Publishing…' : 'Publish auction'}</button>
    </form>
  </main>;
}
