import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, InternalNote, LocaleProvider, PriorityTag, StatusBadge, TextField } from '@bbjp/ui';
import type { Locale } from '@bbjp/ui';

function Gallery() {
  const [locale, setLocale] = useState<Locale>('en');
  return (
    <LocaleProvider locale={locale}>
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
        <h1>BBJP design gallery</h1>
        <Button variant="secondary" onClick={() => setLocale(locale === 'en' ? 'ne' : 'en')}>{locale === 'en' ? 'नेपाली' : 'English'}</Button>
        <form onSubmit={(e) => e.preventDefault()}>
          <TextField label="Full name" required hint="As shown on your ID" />
          <TextField label="Mobile number" error="Enter a 10-digit number" defaultValue="98" />
          <Button type="submit">Submit</Button>
        </form>
        <p><StatusBadge status="under_review" /> <StatusBadge status="more_info_needed" /> <StatusBadge status="completed" /></p>
        <p><PriorityTag level="high" reason="Missing document due in 2 days" /></p>
        <InternalNote>Customer called twice; verify address before decision.</InternalNote>
      </main>
    </LocaleProvider>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><Gallery /></StrictMode>);
