import { Sidebar } from './Sidebar';
import { Hero } from './Hero';

export function Layout() {
    return (
        <div className="flex h-full min-h-screen w-full">
            <Sidebar />
            <Hero />
        </div>
    );
}
