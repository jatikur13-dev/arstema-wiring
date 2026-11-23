import React from 'react';import {createRoot} from 'react-dom/client';import {WiringApp} from '@arstema/wiring';import '@arstema/wiring/style.css';
createRoot(document.getElementById('root')).render(<WiringApp namespace="arstema:react-example" onError={console.error}/>);
