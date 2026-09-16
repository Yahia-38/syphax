const paths = {
  search: 'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8 M16 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87',
};

const DelivererIcon = ({ name }) => (
  <svg aria-hidden='true' focusable='false' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round'>
    <path d={paths[name]} />
  </svg>
);

export default DelivererIcon;
