import React from "react";

export interface TestCordLogoProps extends React.SVGProps<SVGSVGElement> {
    size?: number | string;
}

export function TestCordIcon({ size = 24, className, ...props }: TestCordLogoProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 1000 1000"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            {...props}
        >
            <defs>
                <clipPath id="circleClip">
                    <circle cx="500" cy="500" r="500" />
                </clipPath>
            </defs>

            {/* Circular Orange Background */}
            <circle cx="500" cy="500" r="500" fill="#D65B00" />

            {/* Letter T */}
            <path d="M 152 215 L 575 215 C 570 240, 565 285, 570 345 L 445 348 C 448 450, 448 600, 452 785 L 282 785 C 285 600, 288 450, 290 350 L 152 350 Z" fill="#000000" opacity="0.95" />

            {/* Letter C */}
            <path d="M 825 435 C 800 405, 680 400, 560 480 C 470 540, 460 680, 515 765 C 570 850, 710 870, 825 830 L 820 710 C 740 750, 640 740, 615 690 C 590 640, 600 560, 665 520 C 725 480, 800 500, 825 530 Z" fill="#6A0808" opacity="0.95" />
        </svg>
    );
}

export default TestCordIcon;
