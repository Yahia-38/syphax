'use client';

import { useEditingSession } from '../../components/editing-session.js';

const ObjectiveNavigationForm = ({ children, ...props }) => {
  const session = useEditingSession();
  return <form {...props} method='get' onSubmit={(event) => {
    if (!session) return;
    event.preventDefault();
    const destination = `${event.currentTarget.action.split('?')[0]}?${new URLSearchParams(new FormData(event.currentTarget))}`;
    session.request(() => session.router.push(destination, { scroll: false }));
  }}>{children}</form>;
};

export default ObjectiveNavigationForm;
