import { StoreProvider } from './state/store';
import { Layout } from './components/Layout';

export function App() {
    return (
        <StoreProvider>
            <Layout />
        </StoreProvider>
    );
}
