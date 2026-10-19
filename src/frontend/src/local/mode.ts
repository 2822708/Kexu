/** The mobile release owns its data on the current device. Desktop builds retain their local Java adapter. */
export const LOCAL_MODE =
  import.meta.env.MODE === 'mobile' || import.meta.env.VITE_LOCAL_DATA === 'true'
