const ObjectiveNavigationFields = ({ href, omit = [] }) => {
  const parameters = new URL(href, 'http://syphax.local').searchParams;
  return [...parameters].filter(([name]) => !omit.includes(name))
    .map(([name, value]) => <input key={name} type='hidden' name={name} value={value} />);
};

export default ObjectiveNavigationFields;
