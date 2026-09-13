import './globals.css';

export const metadata = {
  title: 'Syphax',
  description: 'Gestion des achats, du stock et de la distribution',
};

const RootLayout = ({ children }) => {
  return (
    <html lang='fr'>
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
