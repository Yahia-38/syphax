const ProductIcon = ({ name, className }) => {
  const paths = {
    box: <><path d='m12 3 9 5v9l-9 5-9-5V8l9-5Z M3 8l9 5 9-5 M12 13v9' /><path d='m7.5 5.5 9 5v4' /></>,
    stock: <path d='M3 21h18 M4 21V8l8-5 8 5v13 M8 21v-9h8v9 M8 16h8' />,
    identification: <><rect x='3' y='5' width='18' height='15' rx='2' /><path d='M8 3v4 M16 3v4 M7 11h10 M7 15h6' /></>,
    price: <><path d='m3 3 9 .1 9 9-9 9-9-9V3Z' /><circle cx='8' cy='8' r='1.5' /></>,
    clock: <><circle cx='12' cy='12' r='9' /><path d='M12 7v5l3 2' /></>,
    reserved: <><rect x='5' y='10' width='14' height='11' rx='2' /><path d='M8 10V7a4 4 0 0 1 8 0v3' /></>,
    check: <path d='m5 12 4 4L19 6' />,
    info: <><circle cx='12' cy='12' r='9' /><path d='M12 11v6 M12 7v1' /></>,
    search: <><circle cx='10.5' cy='10.5' r='6.5' /><path d='m16 16 5 5' /></>,
    in: <path d='M12 4v16 M6 14l6 6 6-6' />,
    out: <path d='M12 20V4 M6 10l6-6 6 6' />,
    compare: <path d='M3 7h16l-4-4 M21 17H5l4 4' />,
    arrow: <path d='M7 17 17 7 M7 7h10v10' />,
    trash: <path d='M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7' />,
  };
  return <svg aria-hidden='true' className={className} width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'>{paths[name] ?? paths.box}</svg>;
};

export default ProductIcon;
