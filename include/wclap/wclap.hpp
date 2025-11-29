#pragma once

#include <cstdint>

namespace wclap32 {
	template<class T>
	struct Pointer {
		uint32_t wasmPointer;
		Pointer(uint32_t wasmPointer=0) : wasmPointer(wasmPointer) {}
		
		explicit operator bool() const {
			return (bool)wasmPointer;
		}
		
		operator Pointer<const T>() const {
			return {wasmPointer};
		}
		
		template<class T2>
		Pointer<T2> cast() const {
			return {wasmPointer};
		}
		
		Pointer operator+(int32_t delta) {
			return {wasmPointer + delta*sizeof(T)};
		}
		Pointer &operator+=(int32_t delta) {
			wasmPointer += delta*sizeof(T);
			return *this;
		}
	};
	template<class Return, class... Args>
	struct Function {
		uint32_t wasmPointer;
	};

	#include "./_impl/wclap-generic.hpp"
};

namespace wclap64 {
	template<class T>
	struct Pointer {
		uint64_t wasmPointer;
		Pointer(uint64_t wasmPointer=0) : wasmPointer(wasmPointer) {}

		explicit operator bool() const {
			return (bool)wasmPointer;
		}

		operator Pointer<const T>() const {
			return {wasmPointer};
		}

		template<class T2>
		Pointer<T2> cast() const {
			return {wasmPointer};
		}

		Pointer operator+(int64_t delta) {
			return {wasmPointer + delta*sizeof(T)};
		}
		Pointer &operator+=(int64_t delta) {
			wasmPointer += delta*sizeof(T);
			return *this;
		}
	};
	template<class Return, class... Args>
	struct Function {
		uint64_t wasmPointer;
	};

	#include "./_impl/wclap-generic.hpp"
};
